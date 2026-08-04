import { Text, type RegisteredFont } from '@pmndrs/text';
import { slug } from '@pmndrs/text/raster/slug';
import * as THREE from 'three/webgpu';

import type { BenchmarkTarget, TargetRunOutput } from '../../contracts';
import { compactRgba8Readback } from '../../low-level/raster/rgba-readback';
import { BENCHMARK_IPSUM_CONFORMANCE_TEXT } from '../../../workloads/benchmark-ipsum';
import { registeredSlugConfiguration } from '../../low-level/raster/slug-configuration';
import { loadSlugFontAsset } from '../../../workloads/font-assets/slug';
import {
  createConfiguredRenderer,
  disposeConfiguredRenderer,
  type RendererBackend,
} from '../../../renderer/webgpu-renderer';

const WIDTH = 512;
const HEIGHT = 320;

interface SlugProductTargetResources {
  readonly backend: RendererBackend;
  readonly dpr: number;
  readonly renderer: THREE.WebGPURenderer;
  readonly target: THREE.RenderTarget;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly font: RegisteredFont;
  readonly lines: readonly Text[];
  readonly configuration: Awaited<ReturnType<typeof registeredSlugConfiguration>>;
  readonly artifactBytes: number;
  readonly compressedBytes: number;
  readonly fontLoadMs: number;
  readonly firstDrawMs: number;
}

type SlugProductTargetState =
  | { readonly kind: 'empty' }
  | { readonly kind: 'ready'; readonly resources: SlugProductTargetResources };

/** Product benchmark lifecycle for the finite Slug inspection scene. */
export function createSlugTextTarget(backend: RendererBackend): BenchmarkTarget {
  let state: SlugProductTargetState = { kind: 'empty' };
  return {
    id: `slug-text-${backend}`,
    label: backend === 'webgpu' ? 'Slug text · WebGPU' : 'Slug text · WebGL',
    detail: 'Inter GLB · HarfRust layout · analytic curves · shared TSL graph',
    color: backend === 'webgpu' ? 'green' : 'amber',
    capabilities: new Set(['deterministic', 'font-bytes', 'wasm', 'shaping', 'paragraph', 'raster']),
    status: () => 'ready',
    load: async (controls) => {
      if (state.kind === 'ready') return;
      state = { kind: 'ready', resources: await createResources(backend, controls.dpr) };
    },
    run: async () => {
      if (state.kind !== 'ready') throw new Error('Slug text target was not loaded');
      return renderSlugText(state.resources);
    },
    dispose: async () => {
      if (state.kind !== 'ready') return;
      const resources = state.resources;
      state = { kind: 'empty' };
      await disposeResources(resources);
    },
  };
}

async function createResources(backend: RendererBackend, dpr: number): Promise<SlugProductTargetResources> {
  const canvas = document.createElement('canvas');
  const renderer = await createConfiguredRenderer({ canvas, width: WIDTH, height: HEIGHT, backend, dpr });
  let target: THREE.RenderTarget | undefined;
  let font: RegisteredFont | undefined;
  const lines: Text[] = [];
  try {
    const fontStarted = performance.now();
    const loaded = await loadSlugFontAsset({ technique: 'slug', fixture: 'inter', delivery: 'baked' });
    font = loaded.font;
    const fontLoadMs = performance.now() - fontStarted;
    const scene = new THREE.Scene();

    const resizeLine = new Text({
      text: BENCHMARK_IPSUM_CONFORMANCE_TEXT,
      font,
      raster: slug,
      fontSize: 18,
      lineHeight: 1.2,
      width: 280,
      wrap: 'word',
      color: 0xf2f5ff,
    });
    lines.push(resizeLine);
    await resizeLine.ready;
    resizeLine.setProperties({ width: 476 });
    resizeLine.updateMatrixWorld();
    resizeLine.position.set(18, -24, 0);
    scene.add(resizeLine);

    const smallLine = new Text({
      text: 'analytic 12 px  ffi  AV  0123456789',
      font,
      raster: slug,
      fontSize: 12,
      color: 0x7dd3fc,
    });
    lines.push(smallLine);
    await smallLine.ready;
    smallLine.position.set(18, -142, 0);
    scene.add(smallLine);

    const transformLine = new Text({
      text: 'TRANSFORM / SLUG',
      font,
      raster: slug,
      fontSize: 30,
      color: 0xc4b5fd,
    });
    lines.push(transformLine);
    await transformLine.ready;
    transformLine.position.set(252, -194, 0);
    transformLine.rotation.set(-0.2, 0.18, -0.1);
    transformLine.scale.setScalar(0.7);
    scene.add(transformLine);

    const opacityLine = new Text({
      text: 'Fill  Opacity',
      font,
      raster: slug,
      fontSize: 26,
      color: 0xf8fafc,
      opacity: 0.72,
    });
    lines.push(opacityLine);
    await opacityLine.ready;
    opacityLine.position.set(18, -236, 0);
    scene.add(opacityLine);

    const configuration = await registeredSlugConfiguration(font);
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
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x05070d, 1);
    renderer.clear();
    const firstDrawStarted = performance.now();
    renderer.render(scene, camera);
    const firstDrawMs = performance.now() - firstDrawStarted;
    renderer.setRenderTarget(null);
    return {
      backend,
      dpr,
      renderer,
      target,
      scene,
      camera,
      font,
      lines,
      configuration,
      artifactBytes: loaded.artifactBytes,
      compressedBytes: loaded.compressedBytes,
      fontLoadMs,
      firstDrawMs,
    };
  } catch (error) {
    for (const line of lines) line.dispose();
    font?.dispose();
    target?.dispose();
    await disposeConfiguredRenderer(renderer);
    throw error;
  }
}

async function renderSlugText(resources: SlugProductTargetResources): Promise<TargetRunOutput> {
  const { bytes, renderMs, pixelEvidence } = await renderSlugFrame(resources);
  return {
    bytes: bytes.byteLength,
    hash: await sha256(bytes),
    metrics: {
      backendWebGpu: resources.backend === 'webgpu' ? 1 : 0,
      backendWebGl2: resources.backend === 'webgl2' ? 1 : 0,
      dpr: resources.dpr,
      sceneCount: 4,
      textObjectCount: resources.lines.length,
      glyphCount: resources.lines.reduce((sum, line) => sum + renderedGlyphCount(line), 0),
      drawCount: resources.lines.reduce((sum, line) => sum + drawCount(line), 0),
      changedPixels: pixelEvidence.changedPixels,
      distinctRgbColors: pixelEvidence.distinctRgbColors,
      artifactBytes: resources.artifactBytes,
      compressedArtifactBytes: resources.compressedBytes,
      slugPageCount: resources.configuration.pageCount,
      slugCurveGpuBytes: resources.configuration.curveGpuBytes,
      slugHeaderGpuBytes: resources.configuration.headerGpuBytes,
      slugReferenceGpuBytes: resources.configuration.referenceGpuBytes,
      slugGpuBytes: resources.configuration.gpuBytes,
      renderTargetGpuBytes: bytes.byteLength,
      fontLoadMs: resources.fontLoadMs,
      firstDrawMs: resources.firstDrawMs,
      renderMs,
    },
  };
}

async function renderSlugFrame(resources: SlugProductTargetResources): Promise<{
  readonly bytes: Uint8Array;
  readonly renderMs: number;
  readonly pixelEvidence: ReturnType<typeof inspectPixels>;
}> {
  const { renderer, target, scene, camera } = resources;
  const width = Math.round(WIDTH * resources.dpr);
  const height = Math.round(HEIGHT * resources.dpr);
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x05070d, 1);
  renderer.clear();
  const started = performance.now();
  renderer.render(scene, camera);
  const renderMs = performance.now() - started;
  const readback = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
  renderer.setRenderTarget(null);
  const bytes = compactRgba8Readback(
    new Uint8Array(readback.buffer, readback.byteOffset, readback.byteLength),
    width,
    height,
    resources.backend === 'webgl2' ? 'bottom-to-top' : 'top-to-bottom',
  );
  const pixelEvidence = inspectPixels(bytes);
  if (pixelEvidence.changedPixels < 500 || pixelEvidence.distinctRgbColors < 4) {
    throw new Error('Slug product target did not render its expected visible content');
  }
  return { bytes, renderMs, pixelEvidence };
}

async function disposeResources(resources: SlugProductTargetResources): Promise<void> {
  for (const line of resources.lines) line.dispose();
  resources.font.dispose();
  resources.target.dispose();
  await disposeConfiguredRenderer(resources.renderer);
}

function inspectPixels(bytes: Uint8Array): { readonly changedPixels: number; readonly distinctRgbColors: number } {
  let changedPixels = 0;
  const colors = new Set<number>();
  const backgroundRed = bytes[0]!;
  const backgroundGreen = bytes[1]!;
  const backgroundBlue = bytes[2]!;
  const backgroundAlpha = bytes[3]!;
  for (let offset = 0; offset < bytes.byteLength; offset += 4) {
    const red = bytes[offset]!;
    const green = bytes[offset + 1]!;
    const blue = bytes[offset + 2]!;
    const alpha = bytes[offset + 3]!;
    if (red === backgroundRed && green === backgroundGreen && blue === backgroundBlue && alpha === backgroundAlpha) {
      continue;
    }
    changedPixels += 1;
    colors.add((red << 16) | (green << 8) | blue);
  }
  return { changedPixels, distinctRgbColors: colors.size };
}

function renderedGlyphCount(object: THREE.Object3D): number {
  let count = 0;
  object.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry instanceof THREE.InstancedBufferGeometry) {
      count += child.geometry.instanceCount;
    }
  });
  return count;
}

function drawCount(object: THREE.Object3D): number {
  let count = 0;
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) count += 1;
  });
  return count;
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)));
}
