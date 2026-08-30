import type { Font } from '@pmndrs/glyph';
import { Text, TextGroup } from '@pmndrs/glyph/three';
import { glyphExample } from '@pmndrs/glyph-example-raster';
import { registerExternalGlyphExampleThree } from './external-raster-three';

// The consuming app owns the /three integration; the portable raster package and external core renderer remain neutral.
registerExternalGlyphExampleThree();
import * as THREE from 'three/webgpu';

import type { BenchmarkTarget, TargetRunOutput } from '../../contracts';
import { compactRgba8Readback } from '../../low-level/raster/rgba-readback';
import {
  createFontDeliveryMetrics,
  loadSourceFont,
  measuredRuntimeFontBake,
  sourceUrlForFixture,
} from '../../../workloads/font-assets/runtime';
import type { PersistentRenderSceneRenderer } from '../../../renderer/persistent-render-host';
import { withRendererStateRestored } from '../../../renderer/renderer-state-transaction';
import {
  createConfiguredRenderer,
  disposeConfiguredRenderer,
  type RendererBackend,
} from '../../../renderer/webgpu-renderer';

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
  readonly text: Text<typeof glyphExample>;
  readonly textGroup: TextGroup;
  readonly font: Font<typeof glyphExample>;
  readonly orderingGeometry: THREE.PlaneGeometry;
  readonly orderingMaterial: THREE.MeshBasicNodeMaterial;
  readonly retainedMesh: THREE.Mesh;
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
      resources.textGroup.dispose();
      resources.font.dispose();
      resources.orderingGeometry.dispose();
      resources.orderingMaterial.dispose();
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
  let text: Text<typeof glyphExample> | undefined;
  let textGroup: TextGroup | undefined;
  let font: Font<typeof glyphExample> | undefined;
  let orderingGeometry: THREE.PlaneGeometry | undefined;
  let orderingMaterial: THREE.MeshBasicNodeMaterial | undefined;
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
    // The whole point of this target: a package outside @pmndrs/glyph supplies both halves of the boundary — a portable
    // technique loaded through the public loader, and a Three program resolved from the public program registry.
    font = await loadSourceFont({
      source: sourceUrlForFixture('inter'),
      raster: { technique: glyphExample, options: { paletteSeed: 17, inset: 0.1 } },
      runtimeBake: measuredRuntimeFontBake(createFontDeliveryMetrics('runtime')),
      ...(signal === undefined ? {} : { signal }),
    });
    signal?.throwIfAborted();
    text = new Text({
      text: INITIAL_TEXT,
      font,
      style: { fontSize: 48, color: '#ffffff' },
    });
    const scene = new THREE.Scene();
    const coverGroup = new THREE.Group();
    coverGroup.renderOrder = 100;
    orderingGeometry = new THREE.PlaneGeometry(WIDTH, HEIGHT);
    orderingMaterial = new THREE.MeshBasicNodeMaterial({
      color: 0x7f1734,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    const cover = new THREE.Mesh(orderingGeometry, orderingMaterial);
    cover.position.set(WIDTH / 2, -HEIGHT / 2, 0);
    coverGroup.add(cover);
    // The caller-owned parent stays a plain `THREE.Group`: Three derives a render list's `groupOrder` from `isGroup`,
    // so this is the boundary that must order the whole text above the cover. The `TextGroup` inside it owns only the
    // text-local render-order base, which is a separate contract this target also checks.
    textGroup = new TextGroup({ renderOrder: 200 });
    textGroup.add(text);
    const callerGroup = new THREE.Group();
    callerGroup.renderOrder = 200;
    callerGroup.add(textGroup);
    text.position.set(32, -36, 0);
    scene.add(coverGroup, callerGroup);
    // `Text` reconciles while parented, so attaching and forcing one world update is what commits the first revision.
    textGroup.updateMatrixWorld(true);
    if (textGroup.error !== undefined) throw textGroup.error;
    const retainedMesh = exactlyOne(
      textGroup.children.filter((child) => child instanceof THREE.Mesh),
      'external raster draw mesh',
    );
    if (!(retainedMesh instanceof THREE.Mesh) || !(retainedMesh.geometry instanceof THREE.BufferGeometry)) {
      throw new TypeError('external raster did not publish a Three.js mesh');
    }
    const retainedGeometry = retainedMesh.geometry;
    if (Number(retainedMesh.renderOrder) !== 200)
      throw new Error('external raster did not apply the TextGroup render-order base');

    text.set({ text: UPDATED_TEXT });
    textGroup.updateMatrixWorld(true);
    if (textGroup.error !== undefined) throw textGroup.error;
    if (
      textGroup.children.find((child) => child instanceof THREE.Mesh) !== retainedMesh ||
      retainedMesh.geometry !== retainedGeometry
    ) {
      throw new Error('warm external raster update replaced its retained Three.js objects');
    }
    textGroup.renderOrder = 600;
    textGroup.updateMatrixWorld(true);
    if (Number(retainedMesh.renderOrder) !== 600)
      throw new Error('warm external raster did not reapply the TextGroup render-order base');
    textGroup.renderOrder = 200;
    textGroup.updateMatrixWorld(true);
    if (Number(retainedMesh.renderOrder) !== 200)
      throw new Error('warm external raster did not resynchronize the TextGroup render-order base');

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
      textGroup,
      font,
      orderingGeometry,
      orderingMaterial,
      retainedMesh,
      retainedGeometry,
      glyphCount: [...UPDATED_TEXT].length,
    };
  } catch (error) {
    text?.dispose();
    textGroup?.dispose();
    font?.dispose();
    orderingGeometry?.dispose();
    orderingMaterial?.dispose();
    target?.dispose();
    if (ownedRenderer !== undefined) await disposeConfiguredRenderer(ownedRenderer);
    throw error;
  }
}

async function renderResources(resources: ExternalRasterResources, signal?: AbortSignal): Promise<TargetRunOutput> {
  signal?.throwIfAborted();
  const { coverBytes, bytes } = await withRendererStateRestored(resources.renderer, async () => {
    const { renderer, target } = resources;
    const physicalWidth = Math.round(WIDTH * resources.dpr);
    const physicalHeight = Math.round(HEIGHT * resources.dpr);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    resources.text.visible = false;
    let coverFrame: Uint8Array;
    try {
      renderer.clear();
      renderer.render(resources.scene, resources.camera);
      const baselinePixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, physicalWidth, physicalHeight);
      coverFrame = compactRgba8Readback(
        new Uint8Array(baselinePixels.buffer, baselinePixels.byteOffset, baselinePixels.byteLength),
        physicalWidth,
        physicalHeight,
        resources.backend === 'webgl2' ? 'bottom-to-top' : 'top-to-bottom',
      );
    } finally {
      resources.text.visible = true;
    }
    renderer.clear();
    renderer.render(resources.scene, resources.camera);
    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, physicalWidth, physicalHeight);
    return {
      coverBytes: coverFrame,
      bytes: compactRgba8Readback(
        new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
        physicalWidth,
        physicalHeight,
        resources.backend === 'webgl2' ? 'bottom-to-top' : 'top-to-bottom',
      ),
    };
  });
  signal?.throwIfAborted();
  let litPixels = 0;
  let layeringPixels = 0;
  for (let offset = 0; offset < bytes.byteLength; offset += 4) {
    if (bytes[offset] !== 0 || bytes[offset + 1] !== 0 || bytes[offset + 2] !== 0) litPixels += 1;
    if (
      bytes[offset] !== coverBytes[offset] ||
      bytes[offset + 1] !== coverBytes[offset + 1] ||
      bytes[offset + 2] !== coverBytes[offset + 2] ||
      bytes[offset + 3] !== coverBytes[offset + 3]
    ) {
      layeringPixels += 1;
    }
  }
  if (litPixels < 100) {
    throw new Error(`external raster proof produced only ${litPixels} visible pixels`);
  }
  if (layeringPixels < 100) {
    throw new Error(
      `external raster proof changed only ${layeringPixels} pixels over the cover frame (${litPixels} visible pixels)`,
    );
  }
  const liveMesh = exactlyOne(
    resources.textGroup.children.filter((child) => child instanceof THREE.Mesh),
    'retained external raster draw mesh',
  );
  if (liveMesh !== resources.retainedMesh || resources.retainedMesh.geometry !== resources.retainedGeometry) {
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
      layeringPixels,
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
