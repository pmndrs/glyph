import type { LoadedFont, ParagraphLayout } from '@pmndrs/glyph';
import type { msdf as mtsdf } from '@pmndrs/glyph/three/msdf';
import { Text } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';

import {
  conformanceText,
  selectableFontFixture,
  type BenchmarkFontFixture,
  type SelectableFontFixture,
} from '../../../font-fixtures';
import type { TargetRunOutput } from '../../../contracts';
import type { FontDelivery } from '../../../url-state';
import { compareRgba8Coverage, renderFlatMtsdfCpuReference } from '../../../low-level/raster/mtsdf-cpu-reference';
import { compactRgba8Readback } from '../../../low-level/raster/rgba-readback';
import {
  captureSourceOutlineFidelity,
  type SourceOutlineFidelityCapture,
} from '../../../low-level/raster/source-outline-reference';
import { loadMtsdfFontAsset } from '../../../../workloads/font-assets/mtsdf';
import type { PersistentRenderSceneRenderer } from '../../../../renderer/persistent-render-host';
import { withRendererStateRestored } from '../../../../renderer/renderer-state-transaction';
import {
  createConfiguredRenderer,
  disposeConfiguredRenderer,
  type RendererBackend,
} from '../../../../renderer/webgpu-renderer';
import type { RasterConformanceSession } from './contracts';

const WIDTH = 512;
const HEIGHT = 512;

export interface MtsdfTextConformanceCapture {
  readonly width: number;
  readonly height: number;
  readonly candidate: Uint8Array;
  readonly reference: Uint8Array;
  readonly difference: Uint8Array;
  readonly meanAbsoluteError: number;
  readonly maximumError: number;
  readonly errorPixels: number;
  readonly glyphCount: number;
  readonly renderSubmitMs: number;
}

interface FlatMtsdfConformanceResources {
  readonly backend: RendererBackend;
  readonly dpr: number;
  readonly fontFixture: BenchmarkFontFixture;
  readonly renderer: PersistentRenderSceneRenderer;
  readonly ownedRenderer?: THREE.WebGPURenderer;
  readonly target: THREE.RenderTarget;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly font: LoadedFont<typeof mtsdf>;
  readonly line: Text<typeof mtsdf>;
}

/** A warm finite MTSDF session with an optional host renderer lease. */
export function createMtsdfConformanceSession(backend: RendererBackend): RasterConformanceSession {
  let resources: FlatMtsdfConformanceResources | undefined;
  let fontFixture: BenchmarkFontFixture = 'inter';
  return {
    async load(input, controls, context) {
      fontFixture = input.fontFixture ?? 'inter';
      resources ??= await createFlatMtsdfConformanceResources({
        backend,
        dpr: controls.dpr,
        fontFixture,
        delivery: 'baked',
        ...(context?.signal === undefined ? {} : { signal: context.signal }),
        ...(context?.renderer === undefined ? {} : { renderer: context.renderer }),
      });
    },
    async captureSampling(_input, _sampleIndex, _controls, context): Promise<TargetRunOutput> {
      context?.signal?.throwIfAborted();
      if (resources === undefined) throw new Error('MTSDF conformance target was not loaded');
      const capture = await captureFlatMtsdfConformance(resources);
      return {
        bytes: capture.candidate.byteLength,
        hash: await sha256(capture.candidate),
        metrics: {
          backendWebGpu: backend === 'webgpu' ? 1 : 0,
          backendWebGl2: backend === 'webgl2' ? 1 : 0,
          dpr: resources.dpr,
          fixtureIsInter: fontFixture === 'inter' ? 1 : 0,
          pixelCount: capture.width * capture.height,
          glyphCount: capture.glyphCount,
          meanAbsoluteError: capture.meanAbsoluteError,
          maximumError: capture.maximumError,
          errorPixels: capture.errorPixels,
          renderMs: capture.renderSubmitMs,
        },
      };
    },
    async captureSourceOutline(input, controls, context): Promise<SourceOutlineFidelityCapture> {
      return captureMtsdfSourceOutlineFidelity({
        backend,
        dpr: controls.dpr,
        fontFixture: selectableFontFixture(input.fontFixture ?? fontFixture),
        ...(context?.renderer === undefined ? {} : { renderer: context.renderer }),
        ...(context?.signal === undefined ? {} : { signal: context.signal }),
      });
    },
    async dispose() {
      const current = resources;
      resources = undefined;
      if (current !== undefined) await disposeFlatMtsdfConformanceResources(current);
    },
  };
}

export async function captureMtsdfTextConformance(options: {
  readonly backend: RendererBackend;
  readonly delivery?: FontDelivery;
  readonly dpr: number;
  readonly fontFixture?: BenchmarkFontFixture;
  readonly renderer?: PersistentRenderSceneRenderer;
  readonly signal?: AbortSignal;
}): Promise<MtsdfTextConformanceCapture> {
  options.signal?.throwIfAborted();
  const resources = await createFlatMtsdfConformanceResources(options);
  try {
    options.signal?.throwIfAborted();
    const capture = await captureFlatMtsdfConformance(resources);
    options.signal?.throwIfAborted();
    return capture;
  } finally {
    await disposeFlatMtsdfConformanceResources(resources);
  }
}

export async function captureMtsdfSourceOutlineFidelity(options: {
  readonly backend: RendererBackend;
  readonly dpr: number;
  readonly fontFixture: SelectableFontFixture;
  readonly renderer?: PersistentRenderSceneRenderer;
  readonly signal?: AbortSignal;
}): Promise<SourceOutlineFidelityCapture> {
  options.signal?.throwIfAborted();
  const resources = await createFlatMtsdfConformanceResources({ ...options, delivery: 'baked' });
  try {
    const capture = await captureFlatMtsdfConformance(resources);
    options.signal?.throwIfAborted();
    return await captureSourceOutlineFidelity({
      candidate: capture.candidate,
      width: capture.width,
      height: capture.height,
      dpr: options.dpr,
      fontFixture: options.fontFixture,
      fontSize: 64 / options.dpr,
      direction: 'ltr',
      layout: committedLayout(resources.line),
      originX: resources.line.position.x,
      originY: resources.line.position.y,
      text: conformanceText(),
      renderSubmitMs: capture.renderSubmitMs,
    });
  } finally {
    await disposeFlatMtsdfConformanceResources(resources);
  }
}

async function createFlatMtsdfConformanceResources(options: {
  readonly backend: RendererBackend;
  readonly dpr: number;
  readonly fontFixture?: BenchmarkFontFixture;
  readonly signal?: AbortSignal;
  readonly delivery?: FontDelivery;
  readonly renderer?: PersistentRenderSceneRenderer;
}): Promise<FlatMtsdfConformanceResources> {
  const { backend, dpr, signal, renderer: borrowedRenderer } = options;
  const fontFixture = options.fontFixture ?? 'inter';
  const delivery = options.delivery ?? 'baked';
  signal?.throwIfAborted();
  const ownedRenderer =
    borrowedRenderer === undefined
      ? await createConfiguredRenderer({
          canvas: document.createElement('canvas'),
          width: WIDTH,
          height: HEIGHT,
          backend,
          dpr,
        })
      : undefined;
  const renderer = borrowedRenderer ?? ownedRenderer!;
  let target: THREE.RenderTarget | undefined;
  let font: LoadedFont<typeof mtsdf> | undefined;
  let line: Text<typeof mtsdf> | undefined;
  try {
    const loaded = await loadMtsdfFontAsset({
      technique: 'mtsdf',
      fixture: fontFixture,
      delivery,
      ...(signal === undefined ? {} : { signal }),
    });
    font = loaded.loaded;
    line = new Text({
      text: conformanceText(),
      font,
      contentBox: { width: { mode: 'exact', size: 476 }, wrap: 'word' },
      // Match the baked 64 px/em base level in device pixels. Deep minification
      // is exercised separately with the same authored field and derivative AA.
      style: { fontSize: 64 / dpr, lineHeight: 1.2 },
      paint: { color: '#ffffff' },
      rasterPixelRatio: dpr,
    });
    signal?.throwIfAborted();
    line.position.set(18, -18, 0);
    const scene = new THREE.Scene();
    scene.add(line);
    // The retained target binds, shapes, and commits during the world-matrix pass, so the layout the CPU
    // reference reads is only available after it runs.
    scene.updateMatrixWorld(true);
    if (line.error !== undefined) throw line.error;
    const camera = new THREE.OrthographicCamera(0, WIDTH, 0, -HEIGHT, 0.1, 1_000);
    camera.position.z = 500;
    camera.updateProjectionMatrix();
    target = new THREE.RenderTarget(Math.round(WIDTH * dpr), Math.round(HEIGHT * dpr), {
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
    });
    target.texture.colorSpace = THREE.NoColorSpace;
    target.texture.generateMipmaps = false;
    return {
      backend,
      dpr,
      fontFixture,
      renderer,
      ...(ownedRenderer === undefined ? {} : { ownedRenderer }),
      target,
      scene,
      camera,
      font,
      line,
    };
  } catch (error) {
    line?.dispose();
    font?.dispose();
    target?.dispose();
    if (ownedRenderer !== undefined) await disposeConfiguredRenderer(ownedRenderer);
    throw error;
  }
}

async function captureFlatMtsdfConformance(
  resources: FlatMtsdfConformanceResources,
): Promise<MtsdfTextConformanceCapture> {
  const width = Math.round(WIDTH * resources.dpr);
  const height = Math.round(HEIGHT * resources.dpr);
  const { bytes, renderSubmitMs } = await withRendererStateRestored(resources.renderer, async () => {
    resources.renderer.setRenderTarget(resources.target);
    resources.renderer.setClearColor(0x000000, 1);
    resources.renderer.clear();
    const started = performance.now();
    resources.renderer.render(resources.scene, resources.camera);
    const submittedIn = performance.now() - started;
    const readback = await resources.renderer.readRenderTargetPixelsAsync(resources.target, 0, 0, width, height);
    return {
      bytes: new Uint8Array(readback.buffer, readback.byteOffset, readback.byteLength),
      renderSubmitMs: submittedIn,
    };
  });
  const candidate = compactRgba8Readback(
    bytes,
    width,
    height,
    resources.backend === 'webgl2' ? 'bottom-to-top' : 'top-to-bottom',
  );
  const referenceResult = renderFlatMtsdfCpuReference(resources.font.data, committedLayout(resources.line), {
    width,
    height,
    dpr: resources.dpr,
    originX: resources.line.position.x,
    originY: resources.line.position.y,
  });
  const comparison = compareRgba8Coverage(candidate, referenceResult.pixels);
  return {
    width,
    height,
    candidate,
    reference: referenceResult.pixels,
    difference: comparison.heatmap,
    meanAbsoluteError: comparison.meanAbsoluteError,
    maximumError: comparison.maximumError,
    errorPixels: comparison.errorPixels,
    glyphCount: referenceResult.glyphCount,
    renderSubmitMs,
  };
}

async function disposeFlatMtsdfConformanceResources(resources: FlatMtsdfConformanceResources): Promise<void> {
  resources.line.removeFromParent();
  resources.line.dispose();
  resources.font.dispose();
  resources.target.dispose();
  if (resources.ownedRenderer !== undefined) await disposeConfiguredRenderer(resources.ownedRenderer);
}

function committedLayout(line: Text<typeof mtsdf>): ParagraphLayout {
  const layout = line.glyphs();
  if (layout === undefined) throw new Error('MTSDF conformance Text lost its committed layout');
  return layout;
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)));
}
