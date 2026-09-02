import type { Font } from '@pmndrs/glyph';
import { msdf as mtsdf } from '@pmndrs/glyph/three/msdf';
import { FontLoader, type Text } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';
import interCompressedFontUrl from '../fixtures/rendering/inter-mtsdf.font.glb.gz?url';
import showcaseManifest from '../fixtures/rendering/showcase-mtsdf-fixtures-v0.json' with { type: 'json' };
import { proveDetachedRasterParity } from './v1-detached-proof';
import { fetchAuthenticatedGzipAsset } from './workloads/font-assets/authenticated-gzip';
import { createBenchmarkThreeRoot, disposeBenchmarkThreeRoot } from './three-root';

declare global {
  interface Window {
    targetV1MtsdfReady: Promise<TargetV1MtsdfResult>;
  }
}

interface TargetV1MtsdfResult {
  readonly backend: 'webgpu' | 'webgl2';
  readonly drawCount: number;
  readonly glyphCount: number;
  readonly litPixels: number;
  readonly retainedDraw: boolean;
  readonly retainedStorage: boolean;
  readonly detachedFirstFrameMatches: boolean;
  readonly detachedSameFrameWriteMatches: boolean;
  readonly gpuBytes: number;
}

window.targetV1MtsdfReady = render();

async function render(): Promise<TargetV1MtsdfResult> {
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  if (canvas === null) throw new Error('target-v1 MTSDF proof canvas is missing');
  const forceWebGL = new URLSearchParams(location.search).get('backend') === 'webgl2';
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL });
  const loader = new FontLoader();
  const target = new THREE.RenderTarget(256, 128, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
  const root = createBenchmarkThreeRoot('v1-mtsdf');
  target.texture.colorSpace = THREE.NoColorSpace;
  let text: Text<typeof mtsdf> | undefined;
  let font: Font<typeof mtsdf> | undefined;
  let fontUrl: string | undefined;
  try {
    renderer.setSize(256, 128, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    await renderer.init();
    const manifest = showcaseManifest.artifacts.find((artifact) => artifact.fontFixture === 'inter');
    if (manifest === undefined) throw new Error('MTSDF Inter fixture manifest is missing');
    const artifact = await fetchAuthenticatedGzipAsset(interCompressedFontUrl, manifest, 'MTSDF font fixture');
    fontUrl = URL.createObjectURL(new Blob([artifact], { type: 'model/gltf-binary' }));
    font = await loader.loadAsync({
      input: { baked: fontUrl },
      raster: { raster: mtsdf },
    });
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-128, 128, 64, -64, 0.1, 10);
    camera.position.z = 1;
    const parent = new THREE.Group();
    parent.position.set(3, -2, 0);
    parent.rotation.z = 0.07;
    parent.scale.set(1.08, 0.92, 1);
    scene.add(parent);
    text = root.createText({ font, text: 'Target v1 MTSDF', style: { fontSize: 28, color: '#ffffff' } });
    text.position.set(-112, 24, 0);
    parent.add(text);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    await renderer.renderAsync(scene, camera);
    const firstDraw = rootDraws(scene)[0];
    if (firstDraw === undefined) throw new Error('target-v1 MTSDF created no draw');
    const firstStorage = firstDraw.geometry.getAttribute('_pmndrsGlyph_geometry');
    const { detachedFirstFrameMatches, detachedSameFrameWriteMatches } = await proveDetachedRasterParity(
      renderer,
      scene,
      camera,
      target,
      text,
    );
    text.text = 'Target v1 MTSDE';
    await renderer.renderAsync(scene, camera);
    const retainedDraw = rootDraws(scene)[0];
    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 128);
    let litPixels = 0;
    for (let offset = 0; offset < pixels.length; offset += 4)
      if (pixels[offset]! > 8 || pixels[offset + 1]! > 8 || pixels[offset + 2]! > 8) litPixels += 1;
    return {
      backend: renderer.backend instanceof THREE.WebGLBackend ? 'webgl2' : 'webgpu',
      drawCount: rootDraws(scene).length,
      glyphCount: text.measure().glyphCount,
      litPixels,
      retainedDraw: retainedDraw === firstDraw,
      retainedStorage: retainedDraw?.geometry.getAttribute('_pmndrsGlyph_geometry') === firstStorage,
      detachedFirstFrameMatches,
      detachedSameFrameWriteMatches,
      gpuBytes: text.gpuBytes,
    };
  } finally {
    text?.removeFromParent();
    text?.dispose();
    font?.dispose();
    loader.dispose();
    disposeBenchmarkThreeRoot(root);
    target.dispose();
    renderer.dispose();
    if (fontUrl !== undefined) URL.revokeObjectURL(fontUrl);
  }
}

function rootDraws(scene: THREE.Scene): THREE.Mesh[] {
  return scene.getObjectByName('@pmndrs/glyph:v1-mtsdf')?.children.filter((child) => child instanceof THREE.Mesh) ?? [];
}
