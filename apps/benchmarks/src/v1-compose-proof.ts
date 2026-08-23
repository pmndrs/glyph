import type { LoadedFont } from '@pmndrs/glyph';
import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { defineTextMaterial, FontLoader, Text } from '@pmndrs/glyph/three';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

declare global {
  interface Window {
    targetV1ComposeReady: Promise<TargetV1ComposeResult>;
  }
}

interface TargetV1ComposeResult {
  readonly backend: 'webgpu' | 'webgl2';
  readonly drawCount: number;
  readonly glyphCount: number;
  readonly litPixels: number;
  readonly redPixels: number;
  readonly greenPixels: number;
  readonly canonicalLitPixels: number;
  readonly canonicalGreenPixels: number;
}

/**
 * The composed program keeps the canonical position and coverage and tints only the resolved colour. Preserving the
 * canonical glyph footprint while changing the paint is what proves it reuses the exported technique shader.
 */
const composedMaterial = defineTextMaterial((context) => {
  if (context.technique !== bitmap.id) throw new TypeError('compose proof requires the Bitmap material context');
  const material = context.createDefaultMaterial();
  material.colorNode = context.shader.color.mul(TSL.vec3(1, 0, 0));
  return material;
});

window.targetV1ComposeReady = render();

async function render(): Promise<TargetV1ComposeResult> {
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  if (canvas === null) throw new Error('target-v1 compose proof canvas is missing');
  const forceWebGL = new URLSearchParams(location.search).get('backend') === 'webgl2';
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL });
  const loader = new FontLoader();
  const target = new THREE.RenderTarget(256, 128, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
  target.texture.colorSpace = THREE.NoColorSpace;
  let canonicalText: Text<typeof bitmap> | undefined;
  let composedText: Text<typeof bitmap> | undefined;
  let canonicalFont: LoadedFont<typeof bitmap> | undefined;
  try {
    renderer.setSize(256, 128, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    await renderer.init();
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-128, 128, 64, -64, 0.1, 10);
    camera.position.z = 1;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);

    canonicalFont = await loader.loadAsync({
      input: { baked: '/fixtures/rendering/inter-bitmap-16.font.glb' },
      raster: { technique: bitmap, options: { strikes: [16] } },
    });
    canonicalText = new Text({
      font: canonicalFont,
      text: 'Target v1 Bitmap',
      style: { fontSize: 28 },
      paint: { color: '#ffffff' },
    });
    canonicalText.position.set(-112, 24, 0);
    scene.add(canonicalText);
    await renderer.renderAsync(scene, camera);
    const canonical = await countPixels(renderer, target);
    canonicalText.removeFromParent();
    canonicalText.dispose();
    canonicalText = undefined;

    composedText = new Text({
      font: canonicalFont,
      text: 'Target v1 Bitmap',
      style: { fontSize: 28 },
      paint: { color: '#ffffff' },
      material: composedMaterial,
    });
    composedText.position.set(-112, 24, 0);
    scene.add(composedText);
    await renderer.renderAsync(scene, camera);
    const composed = await countPixels(renderer, target);

    return {
      backend: renderer.backend instanceof THREE.WebGLBackend ? 'webgl2' : 'webgpu',
      drawCount: composedText.children.filter((child) => child instanceof THREE.Mesh).length,
      glyphCount: composedText.measure()?.glyphCount ?? 0,
      litPixels: composed.lit,
      redPixels: composed.red,
      greenPixels: composed.green,
      canonicalLitPixels: canonical.lit,
      canonicalGreenPixels: canonical.green,
    };
  } finally {
    canonicalText?.removeFromParent();
    canonicalText?.dispose();
    composedText?.removeFromParent();
    composedText?.dispose();
    canonicalFont?.dispose();
    loader.dispose();
    target.dispose();
    renderer.dispose();
  }
}

interface PixelCounts {
  readonly lit: number;
  readonly red: number;
  readonly green: number;
}

async function countPixels(renderer: THREE.WebGPURenderer, target: THREE.RenderTarget): Promise<PixelCounts> {
  const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 128);
  let lit = 0;
  let red = 0;
  let green = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset]! > 8 || pixels[offset + 1]! > 8 || pixels[offset + 2]! > 8) lit += 1;
    if (pixels[offset]! > 8) red += 1;
    if (pixels[offset + 1]! > 8) green += 1;
  }
  return { lit, red, green };
}
