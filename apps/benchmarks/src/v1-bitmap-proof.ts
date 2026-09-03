import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { loadFont, type Font } from '@pmndrs/glyph';
import type { Text } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';
import { proveDetachedRasterParity } from './v1-detached-proof';
import { createBenchmarkThreeRoot, disposeBenchmarkThreeRoot } from './three-root';

declare global {
  interface Window {
    targetV1BitmapReady: Promise<TargetV1BitmapResult>;
  }
}

interface TargetV1BitmapResult {
  readonly backend: 'webgpu' | 'webgl2';
  readonly drawCount: number;
  readonly decorationPixels: number;
  readonly decorationRecords: number;
  readonly glyphCount: number;
  readonly litPixels: number;
  readonly retainedDraw: boolean;
  readonly retainedStorage: boolean;
  readonly detachedFirstFrameMatches: boolean;
  readonly detachedSameFrameWriteMatches: boolean;
  readonly gpuBytes: number;
}

window.targetV1BitmapReady = render();

async function render(): Promise<TargetV1BitmapResult> {
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  if (canvas === null) throw new Error('target-v1 proof canvas is missing');
  const forceWebGL = new URLSearchParams(location.search).get('backend') === 'webgl2';
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL });
  const target = new THREE.RenderTarget(256, 128, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
  const root = createBenchmarkThreeRoot('v1-bitmap');
  target.texture.colorSpace = THREE.NoColorSpace;
  let text: Text<typeof bitmap> | undefined;
  let font: Font<typeof bitmap> | undefined;
  try {
    renderer.setSize(256, 128, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    await renderer.init();
    font = await loadFont(
      { baked: '/fixtures/rendering/inter-bitmap-16.font.glb' },
      { raster: bitmap, options: { strikes: [16] } },
    );
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-128, 128, 64, -64, 0.1, 10);
    camera.position.z = 1;
    const parent = new THREE.Group();
    parent.position.set(3, -2, 0);
    parent.rotation.z = 0.07;
    parent.scale.set(1.08, 0.92, 1);
    scene.add(parent);
    text = root.createText({
      font,
      text: 'Target v1 Bitmap',
      style: {
        fontSize: 28,
        color: '#ffffff',
        decoration: { underline: true, lineThrough: true, color: '#7dd3fc' },
      },
    });
    text.position.set(-112, 24, 0);
    parent.add(text);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    await renderer.renderAsync(scene, camera);
    const firstDraw = rootDraws(scene)[0];
    if (firstDraw === undefined) throw new Error('target-v1 Bitmap created no draw');
    const firstStorage = firstDraw.geometry.getAttribute('_pmndrsGlyphOrigins');
    const { detachedFirstFrameMatches, detachedSameFrameWriteMatches } = await proveDetachedRasterParity(
      renderer,
      scene,
      camera,
      target,
      text,
    );

    text.text = 'Target v1 Bitmop';
    await renderer.renderAsync(scene, camera);
    const retainedDraw = rootDraws(scene)[0];
    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 128);
    let decorationPixels = 0;
    let litPixels = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset]! > 8 || pixels[offset + 1]! > 8 || pixels[offset + 2]! > 8) litPixels += 1;
      if (pixels[offset + 2]! > pixels[offset]! + 32 && pixels[offset + 1]! > pixels[offset]!) {
        decorationPixels += 1;
      }
    }
    return {
      backend: renderer.backend instanceof THREE.WebGLBackend ? 'webgl2' : 'webgpu',
      decorationPixels,
      decorationRecords: rootDraws(scene)
        .filter((draw) => draw.userData.pmndrsGlyphPrimitiveKind === 'decoration')
        .reduce((count, draw) => {
          if (!(draw.geometry instanceof THREE.InstancedBufferGeometry)) {
            throw new TypeError('decoration proof draw must use instanced geometry');
          }
          return count + draw.geometry.instanceCount;
        }, 0),
      drawCount: rootDraws(scene).length,
      glyphCount: text.measure().glyphCount,
      litPixels,
      retainedDraw: retainedDraw === firstDraw,
      retainedStorage: retainedDraw?.geometry.getAttribute('_pmndrsGlyphOrigins') === firstStorage,
      detachedFirstFrameMatches,
      detachedSameFrameWriteMatches,
      gpuBytes: text.gpuBytes,
    };
  } finally {
    text?.removeFromParent();
    text?.dispose();
    font?.dispose();
    disposeBenchmarkThreeRoot(root);
    target.dispose();
    renderer.dispose();
  }
}

function rootDraws(scene: THREE.Scene): THREE.Mesh[] {
  return (
    scene.getObjectByName('@pmndrs/glyph:v1-bitmap')?.children.filter((child) => child instanceof THREE.Mesh) ?? []
  );
}
