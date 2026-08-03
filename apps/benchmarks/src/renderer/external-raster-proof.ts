import { FontRegistry, Text } from '@pmndrs/text';
import { glyphExample } from '@pmndrs/text-glyph-example-raster';
import * as THREE from 'three/webgpu';

import type { BenchmarkTarget, TargetRunOutput } from '../benchmark/contracts';
import { compactRgba8Readback } from './tsl-baseline';
import { loadBenchmarkFontAsset } from '../workloads/font-assets';
import type { PersistentRenderSceneRenderer } from './persistent-render-host';
import { withRendererStateRestored } from './renderer-state-transaction';
import { createConfiguredRenderer, disposeConfiguredRenderer, type RendererBackend } from './webgpu-renderer';

const WIDTH = 384;
const HEIGHT = 128;
const INITIAL_TEXT = 'PUBLIC RASTER';
const UPDATED_TEXT = 'PLUGIN UPDATE';

interface ExternalRasterResources {
  readonly backend: RendererBackend;
  readonly dpr: number;
  readonly renderer: PersistentRenderSceneRenderer;
  readonly ownedRenderer?: THREE.WebGPURenderer;
  readonly target: THREE.RenderTarget;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly text: Text;
  readonly font: import('@pmndrs/text').RegisteredFont;
  readonly retainedObject: THREE.Object3D;
  readonly retainedGeometry: THREE.BufferGeometry;
  readonly glyphCount: number;
}

type TargetState = { readonly kind: 'empty' } | { readonly kind: 'ready'; readonly resources: ExternalRasterResources };

export function createExternalRasterProofTarget(backend: RendererBackend): BenchmarkTarget {
  let state: TargetState = { kind: 'empty' };
  return {
    id: `external-raster-proof-${backend}`,
    label: `External raster proof · ${backend === 'webgpu' ? 'WebGPU' : 'WebGL'}`,
    detail: 'Private package · public bake/load/Text lifecycle · retained TSL instances',
    color: backend === 'webgpu' ? 'cyan' : 'amber',
    capabilities: new Set(['deterministic', 'font-bytes', 'wasm', 'shaping', 'paragraph', 'raster']),
    status: () => 'ready',
    load: async (controls, context) => {
      if (state.kind === 'ready') return;
      state = {
        kind: 'ready',
        resources: await createResources(backend, controls.dpr, context?.renderer, context?.signal),
      };
    },
    run: async (_input, _sampleIndex, _controls, context) => {
      if (state.kind !== 'ready') throw new Error('external raster proof target was not loaded');
      return renderResources(state.resources, context?.signal);
    },
    dispose: async () => {
      if (state.kind !== 'ready') return;
      const resources = state.resources;
      state = { kind: 'empty' };
      resources.text.dispose();
      resources.font.dispose();
      resources.target.dispose();
      if (resources.ownedRenderer !== undefined) await disposeConfiguredRenderer(resources.ownedRenderer);
    },
  };
}

async function createResources(
  backend: RendererBackend,
  dpr: number,
  borrowedRenderer?: PersistentRenderSceneRenderer,
  signal?: AbortSignal,
): Promise<ExternalRasterResources> {
  signal?.throwIfAborted();
  const ownedRenderer =
    borrowedRenderer === undefined
      ? await createConfiguredRenderer({
          canvas: document.createElement('canvas'),
          dpr,
          width: WIDTH,
          height: HEIGHT,
          backend,
        })
      : undefined;
  const renderer = borrowedRenderer ?? ownedRenderer!;
  let target: THREE.RenderTarget | undefined;
  let text: Text | undefined;
  let font: import('@pmndrs/text').RegisteredFont | undefined;
  try {
    const physicalWidth = Math.round(WIDTH * dpr);
    const physicalHeight = Math.round(HEIGHT * dpr);
    target = new THREE.RenderTarget(physicalWidth, physicalHeight, {
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
    });
    target.texture.colorSpace = THREE.NoColorSpace;
    target.texture.generateMipmaps = false;
    ({ font } = await loadBenchmarkFontAsset({
      technique: 'bitmap',
      fixture: 'inter',
      delivery: 'runtime',
      bitmapDensity: 'conformance',
      registry: new FontRegistry(),
      signal,
    }));
    signal?.throwIfAborted();
    text = new Text({
      text: INITIAL_TEXT,
      font,
      raster: glyphExample({ paletteSeed: 17, inset: 0.1 }),
      fontSize: 48,
      color: 0xffffff,
    });
    const abortText = () => text?.dispose();
    signal?.addEventListener('abort', abortText, { once: true });
    try {
      await text.ready;
      signal?.throwIfAborted();
    } finally {
      signal?.removeEventListener('abort', abortText);
    }
    const retainedObject = exactlyOne(text.children, 'external raster draw object');
    const retainedMesh = exactlyOne(retainedObject.children, 'external raster mesh');
    if (!(retainedMesh instanceof THREE.Mesh) || !(retainedMesh.geometry instanceof THREE.BufferGeometry)) {
      throw new TypeError('external raster did not publish a Three.js mesh');
    }
    const retainedGeometry = retainedMesh.geometry;
    text.setProperties({ text: UPDATED_TEXT });
    text.updateMatrixWorld();
    if (text.children[0] !== retainedObject || retainedObject.children[0] !== retainedMesh) {
      throw new Error('warm external raster update replaced its retained Three.js objects');
    }
    if (text.layout === undefined)
      throw new Error('warm external raster update did not publish during object traversal');
    text.position.set(32, -36, 0);
    const scene = new THREE.Scene();
    scene.add(text);
    const camera = new THREE.OrthographicCamera(0, WIDTH, 0, -HEIGHT, 0.1, 10);
    camera.position.z = 1;
    camera.updateProjectionMatrix();
    return {
      backend,
      dpr,
      renderer,
      ...(ownedRenderer === undefined ? {} : { ownedRenderer }),
      target,
      scene,
      camera,
      text,
      font,
      retainedObject,
      retainedGeometry,
      glyphCount: text.layout.glyphIds.length,
    };
  } catch (error) {
    text?.dispose();
    font?.dispose();
    target?.dispose();
    if (ownedRenderer !== undefined) await disposeConfiguredRenderer(ownedRenderer);
    throw error;
  }
}

async function renderResources(resources: ExternalRasterResources, signal?: AbortSignal): Promise<TargetRunOutput> {
  signal?.throwIfAborted();
  const bytes = await withRendererStateRestored(resources.renderer, async () => {
    const { renderer, target } = resources;
    const physicalWidth = Math.round(WIDTH * resources.dpr);
    const physicalHeight = Math.round(HEIGHT * resources.dpr);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(resources.scene, resources.camera);
    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, physicalWidth, physicalHeight);
    return compactRgba8Readback(
      new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
      physicalWidth,
      physicalHeight,
      resources.backend === 'webgl2' ? 'bottom-to-top' : 'top-to-bottom',
    );
  });
  signal?.throwIfAborted();
  let litPixels = 0;
  for (let offset = 0; offset < bytes.byteLength; offset += 4) {
    if (bytes[offset] !== 0 || bytes[offset + 1] !== 0 || bytes[offset + 2] !== 0) litPixels += 1;
  }
  if (litPixels < 100) throw new Error('external raster proof produced no visible glyph frames');
  const liveObject = exactlyOne(resources.text.children, 'retained external raster draw object');
  const liveMesh = exactlyOne(liveObject.children, 'retained external raster mesh');
  if (
    liveObject !== resources.retainedObject ||
    !(liveMesh instanceof THREE.Mesh) ||
    liveMesh.geometry !== resources.retainedGeometry
  ) {
    throw new Error('external raster proof lost retained object or geometry identity');
  }
  return {
    bytes: bytes.byteLength,
    hash: await sha256(bytes),
    metrics: {
      backendWebGpu: resources.backend === 'webgpu' ? 1 : 0,
      backendWebGl2: resources.backend === 'webgl2' ? 1 : 0,
      dpr: resources.dpr,
      glyphCount: resources.glyphCount,
      drawCount: 1,
      litPixels,
      retainedObject: 1,
      retainedGeometry: 1,
      renderTargetGpuBytes: bytes.byteLength,
    },
  };
}

function exactlyOne<Value>(values: readonly Value[], label: string): Value {
  if (values.length !== 1) throw new Error(`${label} count was ${values.length}; expected 1`);
  return values[0]!;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
