import type { Constraints, Font, ParagraphLayout, TextStyle } from '@pmndrs/glyph';
import type { msdf as mtsdf } from '@pmndrs/glyph/raster/msdf';
import type { slug } from '@pmndrs/glyph/raster/slug';
import type { Text, ThreeRoot } from '@pmndrs/glyph/three';
import * as t3 from '@typegpu/three';
import type { Node } from 'three/webgpu';
import * as THREE from 'three/webgpu';
import { texture } from 'three/tsl';
import { d, std } from 'typegpu';

import { rasterConformanceSpecimen, type SelectableFontFixture } from '../../../benchmark/font-fixtures';
import { loadMtsdfFontAsset } from '../../../workloads/font-assets/mtsdf';
import {
  createPersistentRenderHost,
  type PersistentRenderScene,
  type PersistentRenderSceneContext,
  type PersistentRenderSceneRenderer,
  type PersistentRenderViewport,
} from '../../../renderer/persistent-render-host';
import { loadSlugFontAsset } from '../../../workloads/font-assets/slug';
import type { RendererBackend } from '../../../renderer/webgpu-renderer';
import { createBenchmarkThreeRoot, disposeBenchmarkThreeRoot } from '../../../three-root';

const BACKGROUND = 0x070709;
const BASE_PHYSICAL_PPEM = 64;
const HEATMAP_GAIN = 8;
const PANEL_COUNT = 3;

export interface RasterFormatComparison {
  panBy(deltaX: number, deltaY: number): void;
  resetView(): void;
  resize(width: number, height: number): void;
  setText(text: string): Promise<void>;
  setView(zoom: number, panXPercent: number, panYPercent: number): void;
  zoomBy(factor: number): void;
  dispose(): Promise<void>;
}

export interface RasterFormatComparisonPersistentScene extends PersistentRenderScene {
  panBy(deltaX: number, deltaY: number): void;
  resetView(): void;
  setText(text: string): Promise<void>;
  setView(zoom: number, panXPercent: number, panYPercent: number): void;
  zoomBy(factor: number): void;
}

export interface RasterFormatComparisonPersistentSceneOptions {
  readonly backend: RendererBackend;
  readonly fontFixture: SelectableFontFixture;
  readonly id?: string;
  readonly onError?: (error: unknown) => void;
  readonly onPan?: (deltaXPercent: number, deltaYPercent: number) => void;
  readonly onZoom?: (zoom: number) => void;
  readonly text: string;
}

interface ComparisonResources {
  readonly renderer: PersistentRenderSceneRenderer;
  readonly mtsdfTarget: THREE.RenderTarget;
  readonly slugTarget: THREE.RenderTarget;
  readonly mtsdfScene: THREE.Scene;
  readonly slugScene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly shaping: ComparisonShaping;
  readonly mtsdfFont: Font<typeof mtsdf>;
  readonly slugFont: Font<typeof slug>;
  readonly mtsdfLine: Text<typeof mtsdf>;
  readonly slugLine: Text<typeof slug>;
  readonly mtsdfRoot: ThreeRoot;
  readonly slugRoot: ThreeRoot;
  readonly quad: THREE.QuadMesh;
  readonly mtsdfMaterial: THREE.NodeMaterial;
  readonly slugMaterial: THREE.NodeMaterial;
  readonly heatmapMaterial: THREE.NodeMaterial;
  viewport: PersistentRenderViewport;
}

interface ComparisonLineView {
  readonly fontSize: number;
  readonly rasterPixelRatio: number;
  readonly width: number;
}

interface ComparisonShaping {
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
}

/**
 * Keeps candidate rendering and comparison on the GPU. The two raster-format scenes
 * render into equal RGBA8 targets; a fullscreen TSL pass samples both targets
 * directly to display signed coverage error without readback or CPU composition.
 */
export async function createRasterFormatComparison(options: {
  readonly backend: RendererBackend;
  readonly canvas: HTMLCanvasElement;
  readonly dpr: number;
  readonly fontFixture: SelectableFontFixture;
  readonly height: number;
  readonly onError?: (error: unknown) => void;
  readonly signal?: AbortSignal;
  readonly text: string;
  readonly width: number;
}): Promise<RasterFormatComparison> {
  const width = positiveSize(options.width, 'comparison width');
  const height = positiveSize(options.height, 'comparison height');
  const host = await createPersistentRenderHost({
    backend: options.backend,
    canvas: options.canvas,
    dpr: options.dpr,
    height,
    width,
    onError: options.onError ?? (() => undefined),
  });
  const scene = createRasterFormatComparisonPersistentScene(options);
  try {
    const lease = await host.replaceScene(scene, options.signal);
    let disposal: Promise<void> | undefined;
    return {
      panBy(deltaX, deltaY) {
        scene.panBy(deltaX, deltaY);
      },
      resetView() {
        scene.resetView();
      },
      resize(nextWidth, nextHeight) {
        host.resize(nextWidth, nextHeight);
      },
      setText(nextText) {
        return scene.setText(nextText);
      },
      setView(nextZoom, panXPercent, panYPercent) {
        scene.setView(nextZoom, panXPercent, panYPercent);
      },
      zoomBy(factor) {
        scene.zoomBy(factor);
      },
      dispose() {
        disposal ??= (async () => {
          await lease.release();
          await host.dispose();
        })();
        return disposal;
      },
    };
  } catch (error) {
    await host.dispose();
    throw error;
  }
}

export function createRasterFormatComparisonPersistentScene(
  options: RasterFormatComparisonPersistentSceneOptions,
): RasterFormatComparisonPersistentScene {
  let activation: ComparisonResources | undefined;
  let disposed = false;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let updateRevision = 0;
  let textRevision = 0;
  let committedText = options.text;
  let committedLineView: ComparisonLineView | undefined;
  let candidateUpdatesPending = false;
  let mutationQueue = Promise.resolve();
  const renderWaiters: Array<{ readonly reject: (reason?: unknown) => void; readonly resolve: () => void }> = [];

  const active = (): ComparisonResources => {
    if (disposed || activation === undefined) {
      throw new DOMException('The raster comparison scene is not active', 'InvalidStateError');
    }
    return activation;
  };
  const enqueueMutation = (mutation: () => Promise<void>): Promise<void> => {
    const result = mutationQueue.then(mutation);
    mutationQueue = result.catch(() => undefined);
    return result;
  };
  const rejectRenderWaiters = (reason: unknown): void => {
    for (const waiter of renderWaiters.splice(0)) waiter.reject(reason);
  };
  const waitForFrame = (): Promise<void> => {
    if (disposed || activation === undefined) {
      return Promise.reject(new DOMException('Comparison disposed', 'AbortError'));
    }
    return new Promise((resolve, reject) => renderWaiters.push({ reject, resolve }));
  };
  const updateLines = async (): Promise<void> => {
    const revision = ++updateRevision;
    await enqueueMutation(async () => {
      const resources = activation;
      if (disposed || resources === undefined || revision !== updateRevision) return;
      const previousView = committedLineView;
      if (previousView === undefined) throw new Error('comparison line view is unavailable');
      const nextView = comparisonLineView(resources.viewport, zoom);
      let pairIsRenderable = false;
      candidateUpdatesPending = true;
      try {
        const failure = publishComparisonView(resources, nextView);
        if (disposed || activation !== resources || revision !== updateRevision) return;
        if (failure !== undefined) {
          pairIsRenderable = publishComparisonView(resources, previousView) === undefined;
          throw failure;
        }
        committedLineView = nextView;
        const nextTargetSize = physicalPanelSize(resources.viewport);
        resources.mtsdfTarget.setSize(nextTargetSize.width, nextTargetSize.height);
        resources.slugTarget.setSize(nextTargetSize.width, nextTargetSize.height);
        resources.camera.right = resources.viewport.width / PANEL_COUNT;
        resources.camera.bottom = -resources.viewport.height;
        resources.camera.updateProjectionMatrix();
        resources.mtsdfLine.position.set(18 + panX, -42 + panY, 0);
        resources.slugLine.position.copy(resources.mtsdfLine.position);
        pairIsRenderable = true;
      } finally {
        candidateUpdatesPending = !pairIsRenderable;
      }
    });
  };
  const requestLineUpdate = (): void => {
    void updateLines().catch((error: unknown) => {
      if (!disposed) options.onError?.(error);
    });
  };

  return {
    id: options.id ?? `raster-format-comparison-${options.backend}`,
    async activate(context) {
      if (disposed) throw new DOMException('The raster comparison scene is disposed', 'InvalidStateError');
      if (activation !== undefined) {
        throw new DOMException('The raster comparison scene is already active', 'InvalidStateError');
      }
      context.signal.throwIfAborted();
      activation = await createComparisonResources(context, options.fontFixture, committedText);
      committedLineView = comparisonLineView(activation.viewport, zoom);
    },
    frame() {
      const resources = active();
      try {
        renderComparison(resources, !candidateUpdatesPending);
        for (const waiter of renderWaiters.splice(0)) waiter.resolve();
      } catch (error) {
        rejectRenderWaiters(error);
        options.onError?.(error);
        throw error;
      }
    },
    resize(viewport) {
      const resources = active();
      resources.viewport = viewport;
      requestLineUpdate();
    },
    panBy(deltaX, deltaY) {
      const resources = active();
      const finiteX = finiteDelta(deltaX, 'comparison horizontal pan');
      const finiteY = finiteDelta(deltaY, 'comparison vertical pan');
      panX += finiteX;
      panY -= finiteY;
      options.onPan?.((finiteX / resources.viewport.width) * 300, (-finiteY / resources.viewport.height) * 100);
      requestLineUpdate();
    },
    resetView() {
      const resources = active();
      options.onPan?.((-panX / resources.viewport.width) * 300, (-panY / resources.viewport.height) * 100);
      zoom = 1;
      panX = 0;
      panY = 0;
      options.onZoom?.(zoom);
      requestLineUpdate();
    },
    async setText(nextText) {
      const revision = ++textRevision;
      await enqueueMutation(async () => {
        const resources = activation;
        if (disposed || resources === undefined || revision !== textRevision) return;
        const previousText = committedText;
        let pairIsRenderable = false;
        candidateUpdatesPending = true;
        try {
          const failure = publishComparisonText(resources, nextText);
          if (disposed || activation !== resources || revision !== textRevision) return;
          if (failure !== undefined) {
            pairIsRenderable = publishComparisonText(resources, previousText) === undefined;
            throw failure;
          }
          committedText = nextText;
          pairIsRenderable = true;
        } finally {
          candidateUpdatesPending = !pairIsRenderable;
        }
        await waitForFrame();
      });
    },
    setView(nextZoom, panXPercent, panYPercent) {
      const resources = active();
      if (!Number.isFinite(nextZoom) || nextZoom <= 0) return;
      zoom = Math.min(16, Math.max(0.25, nextZoom));
      panX =
        (finiteDelta(panXPercent, 'comparison horizontal pan percent') / 100) *
        (resources.viewport.width / PANEL_COUNT);
      panY = (finiteDelta(panYPercent, 'comparison vertical pan percent') / 100) * resources.viewport.height;
      requestLineUpdate();
    },
    zoomBy(factor) {
      active();
      if (!Number.isFinite(factor) || factor <= 0) return;
      zoom = Math.min(8, Math.max(1, zoom * factor));
      options.onZoom?.(zoom);
      requestLineUpdate();
    },
    async deactivate() {
      if (disposed) return;
      disposed = true;
      ++updateRevision;
      ++textRevision;
      rejectRenderWaiters(new DOMException('Comparison disposed', 'AbortError'));
      await mutationQueue;
      const resources = activation;
      activation = undefined;
      if (resources !== undefined) disposeComparison(resources);
    },
  };
}

async function createComparisonResources(
  context: PersistentRenderSceneContext,
  fontFixture: SelectableFontFixture,
  text: string,
): Promise<ComparisonResources> {
  let mtsdfFont: Font<typeof mtsdf> | undefined;
  let slugFont: Font<typeof slug> | undefined;
  let mtsdfLine: Text<typeof mtsdf> | undefined;
  let slugLine: Text<typeof slug> | undefined;
  let mtsdfTarget: THREE.RenderTarget | undefined;
  let slugTarget: THREE.RenderTarget | undefined;
  let mtsdfMaterial: THREE.NodeMaterial | undefined;
  let slugMaterial: THREE.NodeMaterial | undefined;
  let heatmapMaterial: THREE.NodeMaterial | undefined;
  const mtsdfRoot = createBenchmarkThreeRoot('raster-comparison-mtsdf');
  const slugRoot = createBenchmarkThreeRoot('raster-comparison-slug');
  try {
    const [mtsdfResult, slugResult] = await Promise.allSettled([
      loadMtsdfFontAsset({ technique: 'mtsdf', fixture: fontFixture, delivery: 'baked', signal: context.signal }),
      loadSlugFontAsset({ technique: 'slug', fixture: fontFixture, delivery: 'baked', signal: context.signal }),
    ]);
    if (mtsdfResult.status === 'rejected') {
      if (slugResult.status === 'fulfilled') slugResult.value.loaded.dispose();
      throw mtsdfResult.reason;
    }
    if (slugResult.status === 'rejected') {
      mtsdfResult.value.loaded.dispose();
      throw slugResult.reason;
    }
    const mtsdfLoaded = mtsdfResult.value;
    const slugLoaded = slugResult.value;
    mtsdfFont = mtsdfLoaded.loaded;
    slugFont = slugLoaded.loaded;
    context.signal.throwIfAborted();
    const specimen = rasterConformanceSpecimen(fontFixture);
    const shaping: ComparisonShaping = { language: specimen.language, direction: specimen.direction };
    const view = comparisonLineView(context.viewport, 1);
    mtsdfLine = mtsdfRoot.createText({ text, font: mtsdfFont, ...lineViewUpdate(shaping, view) });
    slugLine = slugRoot.createText({ text, font: slugFont, ...lineViewUpdate(shaping, view) });
    mtsdfLine.position.set(18, -42, 0);
    slugLine.position.copy(mtsdfLine.position);
    const mtsdfScene = new THREE.Scene();
    const slugScene = new THREE.Scene();
    mtsdfScene.add(mtsdfLine);
    slugScene.add(slugLine);
    // `Text` reconciles while parented, so attaching and forcing one world update is what commits both layouts.
    mtsdfLine.updateMatrixWorld(true);
    slugLine.updateMatrixWorld(true);
    if (mtsdfLine.error !== undefined) throw mtsdfLine.error;
    if (slugLine.error !== undefined) throw slugLine.error;
    context.signal.throwIfAborted();
    const camera = comparisonCamera(context.viewport.width / PANEL_COUNT, context.viewport.height);
    const targetSize = physicalPanelSize(context.viewport);
    mtsdfTarget = comparisonTarget(targetSize.width, targetSize.height, 'MTSDF candidate');
    slugTarget = comparisonTarget(targetSize.width, targetSize.height, 'Slug candidate');
    mtsdfMaterial = new THREE.NodeMaterial();
    mtsdfMaterial.fragmentNode = texture(mtsdfTarget.texture);
    slugMaterial = new THREE.NodeMaterial();
    slugMaterial.fragmentNode = texture(slugTarget.texture);
    heatmapMaterial = new THREE.NodeMaterial();
    heatmapMaterial.fragmentNode = heatmapNode(mtsdfTarget.texture, slugTarget.texture);
    const quad = new THREE.QuadMesh(mtsdfMaterial);
    const resources: ComparisonResources = {
      renderer: context.renderer,
      mtsdfTarget,
      slugTarget,
      mtsdfScene,
      slugScene,
      camera,
      shaping,
      mtsdfFont,
      slugFont,
      mtsdfLine,
      slugLine,
      mtsdfRoot,
      slugRoot,
      quad,
      mtsdfMaterial,
      slugMaterial,
      heatmapMaterial,
      viewport: context.viewport,
    };
    await compileComparison(resources);
    context.signal.throwIfAborted();
    return resources;
  } catch (error) {
    mtsdfLine?.dispose();
    slugLine?.dispose();
    disposeBenchmarkThreeRoot(mtsdfRoot);
    disposeBenchmarkThreeRoot(slugRoot);
    mtsdfFont?.dispose();
    slugFont?.dispose();
    mtsdfTarget?.dispose();
    slugTarget?.dispose();
    mtsdfMaterial?.dispose();
    slugMaterial?.dispose();
    heatmapMaterial?.dispose();
    throw error;
  }
}

function heatmapNode(mtsdfTexture: THREE.Texture, slugTexture: THREE.Texture): Node<'vec4'> {
  const mtsdfCoverage: Node<'float'> = texture(mtsdfTexture).r;
  const slugCoverage: Node<'float'> = texture(slugTexture).r;
  const mtsdfCoverageAccess = t3.fromTSL(mtsdfCoverage, d.f32);
  const slugCoverageAccess = t3.fromTSL(slugCoverage, d.f32);

  return t3.toTSL(() => {
    'use gpu';
    const mtsdfExtra = std.saturate((mtsdfCoverageAccess.$ - slugCoverageAccess.$) * HEATMAP_GAIN);
    const slugExtra = std.saturate((slugCoverageAccess.$ - mtsdfCoverageAccess.$) * HEATMAP_GAIN);
    return d.vec4f(mtsdfExtra, slugExtra, slugExtra, 1);
  }) as Node<'vec4'>;
}

async function compileComparison(resources: ComparisonResources): Promise<void> {
  await withRendererState(resources.renderer, async (renderer) => {
    renderer.setRenderTarget(resources.mtsdfTarget);
    await renderer.compileAsync(resources.mtsdfScene, resources.camera);
    renderer.setRenderTarget(resources.slugTarget);
    await renderer.compileAsync(resources.slugScene, resources.camera);
    renderer.setRenderTarget(null);
    // The quad exposes one mutable material slot. Serialize compilation so each pipeline sees the intended graph.
    resources.quad.material = resources.mtsdfMaterial;
    await renderer.compileAsync(resources.quad, resources.quad.camera);
    resources.quad.material = resources.slugMaterial;
    await renderer.compileAsync(resources.quad, resources.quad.camera);
    resources.quad.material = resources.heatmapMaterial;
    await renderer.compileAsync(resources.quad, resources.quad.camera);
  });
}

/**
 * Both publications occur in one JavaScript task. Candidate target rendering stays paused until both lines commit, so
 * a later frame can never sample one new generation beside one old generation. Returns the first line error, if any,
 * so a caller can roll the pair back together rather than leaving one panel ahead of the other.
 */
function publishComparisonLines(resources: ComparisonResources): unknown {
  resources.mtsdfLine.updateMatrixWorld(true);
  resources.slugLine.updateMatrixWorld(true);
  return resources.mtsdfLine.error ?? resources.slugLine.error;
}

function publishComparisonView(resources: ComparisonResources, view: ComparisonLineView): unknown {
  resources.mtsdfLine.set(lineViewUpdate(resources.shaping, view));
  resources.slugLine.set(lineViewUpdate(resources.shaping, view));
  return publishComparisonLines(resources);
}

function publishComparisonText(resources: ComparisonResources, text: string): unknown {
  resources.mtsdfLine.set({ text });
  resources.slugLine.set({ text });
  return publishComparisonLines(resources);
}

function renderComparison(resources: ComparisonResources, renderCandidates: boolean): void {
  withRendererStateSync(resources.renderer, (renderer) => {
    renderer.autoClear = false;
    renderer.setScissorTest(false);
    if (renderCandidates) {
      renderCandidate(renderer, resources.mtsdfTarget, resources.mtsdfScene, resources.camera);
      renderCandidate(renderer, resources.slugTarget, resources.slugScene, resources.camera);
    }
    renderer.setRenderTarget(null);
    renderer.setClearColor(BACKGROUND, 1);
    renderer.clear();
    const panelWidth = Math.floor(resources.viewport.width / PANEL_COUNT);
    renderer.setScissorTest(true);
    renderPanel(resources, resources.mtsdfMaterial, 0, panelWidth, resources.viewport.height);
    renderPanel(resources, resources.slugMaterial, panelWidth, panelWidth, resources.viewport.height);
    renderPanel(
      resources,
      resources.heatmapMaterial,
      panelWidth * 2,
      resources.viewport.width - panelWidth * 2,
      resources.viewport.height,
    );
  });
}

function renderCandidate(
  renderer: PersistentRenderSceneRenderer,
  target: THREE.RenderTarget,
  scene: THREE.Scene,
  camera: THREE.OrthographicCamera,
): void {
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.render(scene, camera);
}

function renderPanel(
  resources: ComparisonResources,
  material: THREE.NodeMaterial,
  x: number,
  width: number,
  height: number,
): void {
  resources.renderer.setViewport(x, 0, width, height);
  resources.renderer.setScissor(x, 0, width, height);
  resources.quad.material = material;
  renderQuad(resources.quad, resources.renderer);
}

function comparisonTarget(width: number, height: number, name: string): THREE.RenderTarget {
  const target = new THREE.RenderTarget(width, height, {
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
  });
  target.texture.name = name;
  target.texture.colorSpace = THREE.NoColorSpace;
  target.texture.generateMipmaps = false;
  return target;
}

function physicalPanelSize(viewport: PersistentRenderViewport): { readonly width: number; readonly height: number } {
  return {
    width: Math.max(1, Math.round(viewport.drawingBufferWidth / PANEL_COUNT)),
    height: Math.max(1, viewport.drawingBufferHeight),
  };
}

function comparisonLineView(viewport: PersistentRenderViewport, zoom: number): ComparisonLineView {
  return {
    fontSize: (BASE_PHYSICAL_PPEM * zoom) / viewport.dpr,
    rasterPixelRatio: viewport.dpr,
    width: Math.max(120, viewport.width / PANEL_COUNT - 36),
  };
}

/**
 * `set` replaces whole property groups, so every update restates the fixture's shaping context. Dropping it would
 * silently reshape the specimen the moment the viewer zoomed.
 */
function lineViewUpdate(
  shaping: ComparisonShaping,
  view: ComparisonLineView,
): {
  readonly style: TextStyle;
  readonly layout: ParagraphLayout;
  readonly constraints: Constraints;
  readonly rasterPixelRatio: number;
} {
  return {
    style: {
      fontSize: view.fontSize,
      lineHeight: 1.2,
      language: shaping.language,
      direction: shaping.direction,
      color: '#ffffff',
    },
    constraints: { width: { mode: 'at-most', size: view.width } },
    layout: { wrap: 'word' },
    rasterPixelRatio: view.rasterPixelRatio,
  };
}

function comparisonCamera(width: number, height: number): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(0, width, 0, -height, 0.1, 1_000);
  camera.position.z = 500;
  camera.updateProjectionMatrix();
  return camera;
}

function disposeComparison(resources: ComparisonResources): void {
  resources.mtsdfLine.dispose();
  resources.slugLine.dispose();
  disposeBenchmarkThreeRoot(resources.mtsdfRoot);
  disposeBenchmarkThreeRoot(resources.slugRoot);
  resources.mtsdfFont.dispose();
  resources.slugFont.dispose();
  resources.mtsdfTarget.dispose();
  resources.slugTarget.dispose();
  resources.mtsdfMaterial.dispose();
  resources.slugMaterial.dispose();
  resources.heatmapMaterial.dispose();
}

interface RendererState {
  readonly autoClear: boolean;
  readonly clearAlpha: number;
  readonly clearColor: THREE.Color;
  readonly renderTarget: THREE.RenderTarget | null;
  readonly scissor: THREE.Vector4;
  readonly scissorTest: boolean;
  readonly viewport: THREE.Vector4;
}

async function withRendererState<T>(
  borrowedRenderer: PersistentRenderSceneRenderer,
  operation: (renderer: PersistentRenderSceneRenderer) => Promise<T> | T,
): Promise<T> {
  const state = readRendererState(borrowedRenderer);
  try {
    return await operation(borrowedRenderer);
  } finally {
    restoreRendererState(borrowedRenderer, state);
  }
}

function withRendererStateSync<T>(
  borrowedRenderer: PersistentRenderSceneRenderer,
  operation: (renderer: PersistentRenderSceneRenderer) => T,
): T {
  const state = readRendererState(borrowedRenderer);
  try {
    return operation(borrowedRenderer);
  } finally {
    restoreRendererState(borrowedRenderer, state);
  }
}

function readRendererState(renderer: PersistentRenderSceneRenderer): RendererState {
  return {
    autoClear: renderer.autoClear,
    clearAlpha: renderer.getClearAlpha(),
    clearColor: renderer.getClearColor(new THREE.Color()),
    renderTarget: renderer.getRenderTarget(),
    scissor: renderer.getScissor(new THREE.Vector4()),
    scissorTest: renderer.getScissorTest(),
    viewport: renderer.getViewport(new THREE.Vector4()),
  };
}

function restoreRendererState(renderer: PersistentRenderSceneRenderer, state: RendererState): void {
  renderer.autoClear = state.autoClear;
  renderer.setRenderTarget(state.renderTarget);
  renderer.setClearColor(state.clearColor, state.clearAlpha);
  renderer.setViewport(state.viewport);
  renderer.setScissor(state.scissor);
  renderer.setScissorTest(state.scissorTest);
}

function renderQuad(quad: THREE.QuadMesh, renderer: PersistentRenderSceneRenderer): void {
  // The host removes lifecycle methods from the borrowed type. Three.js render helpers require the wider class even
  // though this comparison only uses draw, target, compilation, and frame-state methods.
  quad.render(renderer as THREE.WebGPURenderer);
}

function positiveSize(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive`);
  return value;
}

function finiteDelta(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
}
