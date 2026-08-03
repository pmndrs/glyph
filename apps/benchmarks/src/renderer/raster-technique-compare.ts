import { Text, type RegisteredFont } from '@pmndrs/text';
import type { Node } from 'three/webgpu';
import * as THREE from 'three/webgpu';
import { mul, saturate, sub, texture, vec4 } from 'three/tsl';

import { rasterConformanceSpecimen, type SelectableFontFixture } from '../benchmark/font-fixtures';
import { loadMtsdfFont } from './mtsdf-text';
import {
  createPersistentRenderHost,
  type PersistentRenderScene,
  type PersistentRenderSceneContext,
  type PersistentRenderSceneRenderer,
  type PersistentRenderViewport,
} from './persistent-render-host';
import { loadSlugFont } from './slug-text';
import type { RendererBackend } from './webgpu-renderer';

const BACKGROUND = 0x070709;
const BASE_PHYSICAL_PPEM = 64;
const HEATMAP_GAIN = 8;
const PANEL_COUNT = 3;

export interface RasterTechniqueComparison {
  panBy(deltaX: number, deltaY: number): void;
  resetView(): void;
  resize(width: number, height: number): void;
  setText(text: string): Promise<void>;
  setView(zoom: number, panXPercent: number, panYPercent: number): void;
  zoomBy(factor: number): void;
  dispose(): Promise<void>;
}

export interface RasterTechniqueComparisonPersistentScene extends PersistentRenderScene {
  panBy(deltaX: number, deltaY: number): void;
  resetView(): void;
  setText(text: string): Promise<void>;
  setView(zoom: number, panXPercent: number, panYPercent: number): void;
  zoomBy(factor: number): void;
}

export interface RasterTechniqueComparisonPersistentSceneOptions {
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
  readonly mtsdfFont: RegisteredFont;
  readonly slugFont: RegisteredFont;
  readonly mtsdfLine: Text;
  readonly slugLine: Text;
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

/**
 * Keeps candidate rendering and comparison on the GPU. The two technique scenes
 * render into equal RGBA8 targets; a fullscreen TSL pass samples both targets
 * directly to display signed coverage error without readback or CPU composition.
 */
export async function createRasterTechniqueComparison(options: {
  readonly backend: RendererBackend;
  readonly canvas: HTMLCanvasElement;
  readonly dpr: number;
  readonly fontFixture: SelectableFontFixture;
  readonly height: number;
  readonly onError?: (error: unknown) => void;
  readonly signal?: AbortSignal;
  readonly text: string;
  readonly width: number;
}): Promise<RasterTechniqueComparison> {
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
  const scene = createRasterTechniqueComparisonPersistentScene(options);
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

export function createRasterTechniqueComparisonPersistentScene(
  options: RasterTechniqueComparisonPersistentSceneOptions,
): RasterTechniqueComparisonPersistentScene {
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
        resources.mtsdfLine.setProperties(nextView);
        resources.slugLine.setProperties(nextView);
        publishComparisonLines(resources);
        const results = await Promise.allSettled([resources.mtsdfLine.ready, resources.slugLine.ready]);
        if (disposed || activation !== resources || revision !== updateRevision) return;
        const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failure !== undefined) {
          resources.mtsdfLine.setProperties(previousView);
          resources.slugLine.setProperties(previousView);
          publishComparisonLines(resources);
          const rollback = await Promise.allSettled([resources.mtsdfLine.ready, resources.slugLine.ready]);
          pairIsRenderable = rollback.every((result) => result.status === 'fulfilled');
          throw failure.reason;
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
    id: options.id ?? `raster-technique-comparison-${options.backend}`,
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
          resources.mtsdfLine.setProperties({ text: nextText });
          resources.slugLine.setProperties({ text: nextText });
          publishComparisonLines(resources);
          const results = await Promise.allSettled([resources.mtsdfLine.ready, resources.slugLine.ready]);
          if (disposed || activation !== resources || revision !== textRevision) return;
          const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
          if (failure !== undefined) {
            resources.mtsdfLine.setProperties({ text: previousText });
            resources.slugLine.setProperties({ text: previousText });
            publishComparisonLines(resources);
            const rollback = await Promise.allSettled([resources.mtsdfLine.ready, resources.slugLine.ready]);
            pairIsRenderable = rollback.every((result) => result.status === 'fulfilled');
            throw failure.reason;
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
  let mtsdfFont: RegisteredFont | undefined;
  let slugFont: RegisteredFont | undefined;
  let mtsdfLine: Text | undefined;
  let slugLine: Text | undefined;
  let mtsdfTarget: THREE.RenderTarget | undefined;
  let slugTarget: THREE.RenderTarget | undefined;
  let mtsdfMaterial: THREE.NodeMaterial | undefined;
  let slugMaterial: THREE.NodeMaterial | undefined;
  let heatmapMaterial: THREE.NodeMaterial | undefined;
  try {
    const [mtsdfResult, slugResult] = await Promise.allSettled([
      loadMtsdfFont(context.signal, fontFixture),
      loadSlugFont(context.signal, fontFixture),
    ]);
    if (mtsdfResult.status === 'rejected') {
      if (slugResult.status === 'fulfilled') slugResult.value.font.dispose();
      throw mtsdfResult.reason;
    }
    if (slugResult.status === 'rejected') {
      mtsdfResult.value.font.dispose();
      throw slugResult.reason;
    }
    const mtsdfLoaded = mtsdfResult.value;
    const slugLoaded = slugResult.value;
    mtsdfFont = mtsdfLoaded.font;
    slugFont = slugLoaded.font;
    context.signal.throwIfAborted();
    const panelWidth = context.viewport.width / PANEL_COUNT;
    const fontSize = BASE_PHYSICAL_PPEM / context.viewport.dpr;
    const specimen = rasterConformanceSpecimen(fontFixture);
    mtsdfLine = new Text({
      text,
      font: mtsdfLoaded.font,
      raster: mtsdfLoaded.raster,
      fontSize,
      rasterPixelRatio: context.viewport.dpr,
      lineHeight: 1.2,
      width: Math.max(120, panelWidth - 36),
      wrap: 'word',
      color: 0xffffff,
      language: specimen.language,
      direction: specimen.direction,
    });
    slugLine = new Text({
      text,
      font: slugLoaded.font,
      raster: slugLoaded.raster,
      fontSize,
      rasterPixelRatio: context.viewport.dpr,
      lineHeight: 1.2,
      width: Math.max(120, panelWidth - 36),
      wrap: 'word',
      color: 0xffffff,
      language: specimen.language,
      direction: specimen.direction,
    });
    await Promise.all([mtsdfLine.ready, slugLine.ready]);
    context.signal.throwIfAborted();
    mtsdfLine.position.set(18, -42, 0);
    slugLine.position.copy(mtsdfLine.position);
    const mtsdfScene = new THREE.Scene();
    const slugScene = new THREE.Scene();
    mtsdfScene.add(mtsdfLine);
    slugScene.add(slugLine);
    const camera = comparisonCamera(panelWidth, context.viewport.height);
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
      mtsdfFont: mtsdfLoaded.font,
      slugFont: slugLoaded.font,
      mtsdfLine,
      slugLine,
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
  const mtsdfExtra: Node<'float'> = saturate(mul(sub(mtsdfCoverage, slugCoverage), HEATMAP_GAIN));
  const slugExtra: Node<'float'> = saturate(mul(sub(slugCoverage, mtsdfCoverage), HEATMAP_GAIN));
  return vec4(mtsdfExtra, slugExtra, slugExtra, 1);
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

function publishComparisonLines(resources: ComparisonResources): void {
  // Both publications occur in one JavaScript task. Candidate target rendering remains paused until every async
  // preparation settles, so a later frame can never sample one new generation beside one old generation.
  resources.mtsdfLine.updateMatrixWorld(true);
  resources.slugLine.updateMatrixWorld(true);
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

function comparisonCamera(width: number, height: number): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(0, width, 0, -height, 0.1, 1_000);
  camera.position.z = 500;
  camera.updateProjectionMatrix();
  return camera;
}

function disposeComparison(resources: ComparisonResources): void {
  resources.mtsdfLine.dispose();
  resources.slugLine.dispose();
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
