import { Text, type RegisteredFont } from '@pmndrs/text';
import type { Node } from 'three/webgpu';
import * as THREE from 'three/webgpu';
import { mul, saturate, sub, texture, vec4 } from 'three/tsl';

import { rasterConformanceSpecimen, type SelectableFontFixture } from '../benchmark/font-fixtures';
import { loadMtsdfFont } from './mtsdf-text';
import { loadSlugFont } from './slug-text';
import { createConfiguredRenderer, disposeConfiguredRenderer, type RendererBackend } from './webgpu-renderer';

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

interface ComparisonResources {
  readonly renderer: THREE.WebGPURenderer;
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
  const { backend, canvas, dpr, fontFixture, onError, signal } = options;
  signal?.throwIfAborted();
  let width = positiveSize(options.width, 'comparison width');
  let height = positiveSize(options.height, 'comparison height');
  const renderer = await createConfiguredRenderer({
    backend,
    canvas,
    dpr,
    height,
    width,
    initialClearColor: BACKGROUND,
  });
  renderer.autoClear = false;
  let resources: ComparisonResources | undefined;
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
      loadMtsdfFont(signal, fontFixture),
      loadSlugFont(signal, fontFixture),
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
    signal?.throwIfAborted();
    const panelWidth = width / PANEL_COUNT;
    const fontSize = BASE_PHYSICAL_PPEM / dpr;
    const specimen = rasterConformanceSpecimen(fontFixture);
    mtsdfLine = new Text({
      text: options.text,
      font: mtsdfLoaded.font,
      raster: mtsdfLoaded.raster,
      fontSize,
      rasterPixelRatio: dpr,
      lineHeight: 1.2,
      width: Math.max(120, panelWidth - 36),
      wrap: 'word',
      color: 0xffffff,
      language: specimen.language,
      direction: specimen.direction,
    });
    slugLine = new Text({
      text: options.text,
      font: slugLoaded.font,
      raster: slugLoaded.raster,
      fontSize,
      rasterPixelRatio: dpr,
      lineHeight: 1.2,
      width: Math.max(120, panelWidth - 36),
      wrap: 'word',
      color: 0xffffff,
      language: specimen.language,
      direction: specimen.direction,
    });
    await Promise.all([mtsdfLine.ready, slugLine.ready]);
    signal?.throwIfAborted();
    mtsdfLine.position.set(18, -42, 0);
    slugLine.position.copy(mtsdfLine.position);
    const mtsdfScene = new THREE.Scene();
    const slugScene = new THREE.Scene();
    mtsdfScene.add(mtsdfLine);
    slugScene.add(slugLine);
    const camera = comparisonCamera(panelWidth, height);
    const targetSize = physicalPanelSize(renderer, width, height);
    mtsdfTarget = comparisonTarget(targetSize.width, targetSize.height, 'MTSDF candidate');
    slugTarget = comparisonTarget(targetSize.width, targetSize.height, 'Slug candidate');
    mtsdfMaterial = new THREE.NodeMaterial();
    mtsdfMaterial.fragmentNode = texture(mtsdfTarget.texture);
    slugMaterial = new THREE.NodeMaterial();
    slugMaterial.fragmentNode = texture(slugTarget.texture);
    heatmapMaterial = new THREE.NodeMaterial();
    heatmapMaterial.fragmentNode = heatmapNode(mtsdfTarget.texture, slugTarget.texture);
    const quad = new THREE.QuadMesh(mtsdfMaterial);
    resources = {
      renderer,
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
    };
    renderer.setRenderTarget(mtsdfTarget);
    await renderer.compileAsync(mtsdfScene, camera);
    renderer.setRenderTarget(slugTarget);
    await renderer.compileAsync(slugScene, camera);
    renderer.setRenderTarget(null);
    // compileAsync mutates renderer compilation state, and the quad exposes only one mutable material slot.
    // Keep these passes serialized so each pipeline is compiled for the material assigned to the quad.
    quad.material = mtsdfMaterial;
    await renderer.compileAsync(quad, quad.camera);
    quad.material = slugMaterial;
    await renderer.compileAsync(quad, quad.camera);
    quad.material = heatmapMaterial;
    await renderer.compileAsync(quad, quad.camera);
    signal?.throwIfAborted();
    const activeResources = resources;
    const activeMtsdfLine = activeResources.mtsdfLine;
    const activeSlugLine = activeResources.slugLine;
    const activeMtsdfTarget = activeResources.mtsdfTarget;
    const activeSlugTarget = activeResources.slugTarget;

    let zoom = 1;
    let panX = 0;
    let panY = 0;
    let closing = false;
    let disposed = false;
    let scheduledFrame: number | undefined;
    let updateRevision = 0;
    let textRevision = 0;
    let committedText = options.text;
    let mutationQueue = Promise.resolve();
    const renderWaiters: Array<{
      readonly reject: (reason?: unknown) => void;
      readonly resolve: () => void;
    }> = [];

    const enqueueMutation = (mutation: () => Promise<void>): Promise<void> => {
      const result = mutationQueue.then(mutation);
      mutationQueue = result.catch(() => undefined);
      return result;
    };
    const rejectRenderWaiters = (reason: unknown): void => {
      for (const waiter of renderWaiters.splice(0)) waiter.reject(reason);
    };

    const render = (): void => {
      scheduledFrame = undefined;
      if (closing || disposed) return;
      try {
        renderComparison(activeResources);
        for (const waiter of renderWaiters.splice(0)) waiter.resolve();
      } catch (error) {
        rejectRenderWaiters(error);
        onError?.(error);
      }
    };
    const scheduleRender = (): void => {
      if (scheduledFrame !== undefined || closing || disposed) return;
      scheduledFrame = requestAnimationFrame(render);
    };
    const waitForScheduledRender = (): Promise<void> => {
      if (closing || disposed) {
        return Promise.reject(new DOMException('Comparison disposed', 'AbortError'));
      }
      scheduleRender();
      return new Promise((resolve, reject) => renderWaiters.push({ reject, resolve }));
    };
    const updateLines = async (): Promise<void> => {
      const revision = ++updateRevision;
      await enqueueMutation(async () => {
        if (closing || disposed || revision !== updateRevision) return;
        const nextFontSize = (BASE_PHYSICAL_PPEM * zoom) / dpr;
        const nextWidth = Math.max(120, width / PANEL_COUNT - 36);
        activeMtsdfLine.setProperties({ fontSize: nextFontSize, width: nextWidth });
        activeSlugLine.setProperties({ fontSize: nextFontSize, width: nextWidth });
        await Promise.all([activeMtsdfLine.ready, activeSlugLine.ready]);
        if (closing || disposed || revision !== updateRevision) return;
        const originX = 18 + panX;
        const originY = -42 + panY;
        activeMtsdfLine.position.set(originX, originY, 0);
        activeSlugLine.position.copy(activeMtsdfLine.position);
        scheduleRender();
      });
    };
    const requestLineUpdate = (): void => {
      void updateLines().catch((error: unknown) => {
        if (closing || disposed) return;
        onError?.(error);
      });
    };

    renderComparison(activeResources);
    return {
      panBy(deltaX, deltaY) {
        if (closing || disposed) return;
        panX += finiteDelta(deltaX, 'comparison horizontal pan');
        panY -= finiteDelta(deltaY, 'comparison vertical pan');
        requestLineUpdate();
      },
      resetView() {
        if (closing || disposed) return;
        zoom = 1;
        panX = 0;
        panY = 0;
        requestLineUpdate();
      },
      resize(nextWidth, nextHeight) {
        if (closing || disposed) return;
        width = positiveSize(nextWidth, 'comparison width');
        height = positiveSize(nextHeight, 'comparison height');
        renderer.setSize(width, height, false);
        const nextTargetSize = physicalPanelSize(renderer, width, height);
        activeMtsdfTarget.setSize(nextTargetSize.width, nextTargetSize.height);
        activeSlugTarget.setSize(nextTargetSize.width, nextTargetSize.height);
        camera.right = width / PANEL_COUNT;
        camera.bottom = -height;
        camera.updateProjectionMatrix();
        requestLineUpdate();
      },
      async setText(nextText) {
        const revision = ++textRevision;
        await enqueueMutation(async () => {
          if (closing || disposed || revision !== textRevision) return;
          const previousText = committedText;
          activeMtsdfLine.setProperties({ text: nextText });
          activeSlugLine.setProperties({ text: nextText });
          const results = await Promise.allSettled([activeMtsdfLine.ready, activeSlugLine.ready]);
          if (closing || disposed || revision !== textRevision) return;
          const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
          if (failure !== undefined) {
            activeMtsdfLine.setProperties({ text: previousText });
            activeSlugLine.setProperties({ text: previousText });
            await Promise.allSettled([activeMtsdfLine.ready, activeSlugLine.ready]);
            if (!closing && !disposed && revision === textRevision) {
              await waitForScheduledRender();
            }
            throw failure.reason;
          }
          committedText = nextText;
          await waitForScheduledRender();
        });
      },
      setView(nextZoom, panXPercent, panYPercent) {
        if (closing || disposed) return;
        if (!Number.isFinite(nextZoom) || nextZoom <= 0) return;
        zoom = Math.min(16, Math.max(0.25, nextZoom));
        panX = (finiteDelta(panXPercent, 'comparison horizontal pan percent') / 100) * (width / PANEL_COUNT);
        panY = (finiteDelta(panYPercent, 'comparison vertical pan percent') / 100) * height;
        requestLineUpdate();
      },
      zoomBy(factor) {
        if (closing || disposed) return;
        if (!Number.isFinite(factor) || factor <= 0) return;
        zoom = Math.min(16, Math.max(0.25, zoom * factor));
        requestLineUpdate();
      },
      async dispose() {
        if (disposed) return;
        closing = true;
        if (scheduledFrame !== undefined) cancelAnimationFrame(scheduledFrame);
        rejectRenderWaiters(new DOMException('Comparison disposed', 'AbortError'));
        await mutationQueue;
        disposed = true;
        disposeComparison(activeResources);
        await disposeConfiguredRenderer(renderer);
      },
    };
  } catch (error) {
    if (resources !== undefined) {
      disposeComparison(resources);
    } else {
      mtsdfLine?.dispose();
      slugLine?.dispose();
      mtsdfFont?.dispose();
      slugFont?.dispose();
      mtsdfTarget?.dispose();
      slugTarget?.dispose();
      mtsdfMaterial?.dispose();
      slugMaterial?.dispose();
      heatmapMaterial?.dispose();
    }
    await disposeConfiguredRenderer(renderer);
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

function renderComparison(resources: ComparisonResources): void {
  const { renderer } = resources;
  renderer.setScissorTest(false);
  renderCandidate(renderer, resources.mtsdfTarget, resources.mtsdfScene, resources.camera);
  renderCandidate(renderer, resources.slugTarget, resources.slugScene, resources.camera);
  renderer.setRenderTarget(null);
  renderer.setClearColor(BACKGROUND, 1);
  renderer.clear();
  // WebGPURenderer applies its pixel ratio to viewport/scissor inputs.
  const size = renderer.getSize(new THREE.Vector2());
  const panelWidth = Math.floor(size.x / PANEL_COUNT);
  renderer.setScissorTest(true);
  renderPanel(resources, resources.mtsdfMaterial, 0, panelWidth, size.y);
  renderPanel(resources, resources.slugMaterial, panelWidth, panelWidth, size.y);
  renderPanel(resources, resources.heatmapMaterial, panelWidth * 2, size.x - panelWidth * 2, size.y);
  renderer.setScissorTest(false);
}

function renderCandidate(
  renderer: THREE.WebGPURenderer,
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
  resources.quad.render(resources.renderer);
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

function physicalPanelSize(
  renderer: THREE.WebGPURenderer,
  width: number,
  height: number,
): { readonly width: number; readonly height: number } {
  const dpr = renderer.getPixelRatio();
  return {
    width: Math.max(1, Math.round((width / PANEL_COUNT) * dpr)),
    height: Math.max(1, Math.round(height * dpr)),
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

function positiveSize(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive`);
  return value;
}

function finiteDelta(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
}
