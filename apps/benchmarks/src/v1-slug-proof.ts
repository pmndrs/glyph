import { glyph, type FontFace } from '@pmndrs/glyph';
import { slug } from '@pmndrs/glyph/raster/slug';
import type { Text } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';
import interCompressedFontUrl from '../fixtures/rendering/inter-slug.font.glb.gz?url';
import showcaseManifest from '../fixtures/rendering/showcase-slug-fixtures-v0.json' with { type: 'json' };
import { proveDetachedRasterParity } from './v1-detached-proof';
import { countV1DecorationRecords, countV1RasterPixels, V1_DECORATION_COLOR, v1GlyphDraw } from './v1-decoration-proof';
import { fetchAuthenticatedGzipAsset } from './workloads/font-assets/authenticated-gzip';
import { createBenchmarkThreeRoot, disposeBenchmarkThreeRoot } from './three-root';

declare global {
  interface Window {
    targetV1SlugReady: Promise<TargetV1SlugResult>;
  }
}

interface TargetV1SlugResult {
  readonly backend: 'webgpu' | 'webgl2';
  readonly decorationPixels: number;
  readonly decorationRecords: number;
  readonly drawCount: number;
  readonly glyphCount: number;
  readonly litPixels: number;
  readonly retainedDraw: boolean;
  readonly retainedStorage: boolean;
  readonly detachedFirstFrameMatches: boolean;
  readonly detachedSameFrameWriteMatches: boolean;
  readonly gpuBytes: number;
}

window.targetV1SlugReady = render();

async function render(): Promise<TargetV1SlugResult> {
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  if (canvas === null) throw new Error('target-v1 Slug proof canvas is missing');
  const forceWebGL = new URLSearchParams(location.search).get('backend') === 'webgl2';
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL });
  const target = new THREE.RenderTarget(256, 128, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
  const root = createBenchmarkThreeRoot('v1-slug');
  target.texture.colorSpace = THREE.NoColorSpace;
  let text: Text<typeof slug> | undefined;
  let fontFace: FontFace<typeof slug> | undefined;
  try {
    renderer.setSize(256, 128, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    await renderer.init();
    const manifest = showcaseManifest.artifacts.find((artifact) => artifact.fontFixture === 'inter');
    if (manifest === undefined) throw new Error('Slug Inter fixture manifest is missing');
    const artifact = await fetchAuthenticatedGzipAsset(interCompressedFontUrl, manifest, 'Slug font fixture');
    fontFace = glyph.fontFace(new Blob([artifact], { type: 'model/gltf-binary' }), { format: slug });
    await fontFace.load();
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-128, 128, 64, -64, 0.1, 10);
    camera.position.z = 1;
    const parent = new THREE.Group();
    parent.position.set(3, -2, 0);
    parent.rotation.z = 0.07;
    parent.scale.set(1.08, 0.92, 1);
    scene.add(parent);
    text = root.createText({
      font: fontFace,
      text: 'Target v1 Slug',
      style: {
        fontSize: 28,
        color: '#ffffff',
        decoration: { underline: true, lineThrough: true, color: V1_DECORATION_COLOR },
      },
    });
    text.position.set(-112, 24, 0);
    parent.add(text);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    await renderer.renderAsync(scene, camera);
    const firstDraw = v1GlyphDraw(rootDraws(scene));
    if (firstDraw === undefined) throw new Error('target-v1 Slug created no draw');
    const firstStorage = firstDraw.geometry.getAttribute('_pmndrsGlyph_geometry');
    const { detachedFirstFrameMatches, detachedSameFrameWriteMatches } = await proveDetachedRasterParity(
      renderer,
      scene,
      camera,
      target,
      text,
    );
    text.text = 'Target v1 Plug';
    await renderer.renderAsync(scene, camera);
    const retainedDraw = v1GlyphDraw(rootDraws(scene));
    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 128);
    const { decorationPixels, litPixels } = countV1RasterPixels(pixels);
    return {
      backend: renderer.backend instanceof THREE.WebGLBackend ? 'webgl2' : 'webgpu',
      decorationPixels,
      decorationRecords: countV1DecorationRecords(rootDraws(scene)),
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
    fontFace?.dispose();
    disposeBenchmarkThreeRoot(root);
    target.dispose();
    renderer.dispose();
  }
}

function rootDraws(scene: THREE.Scene): THREE.Mesh[] {
  return scene.getObjectByName('@pmndrs/glyph:v1-slug')?.children.filter((child) => child instanceof THREE.Mesh) ?? [];
}
