import { type Font, type FontFace, bitmap, glyph, slug } from '@pmndrs/glyph';
import { defineTextMaterial, type Text, type ThreeRoot, type ThreeTextMaterial } from '@pmndrs/glyph/three';

import interCompressedFontUrl from '../fixtures/rendering/inter-slug.font.glb.gz?url';
import showcaseManifest from '../fixtures/rendering/showcase-slug-fixtures-v0.json' with { type: 'json' };
import { fetchAuthenticatedGzipAsset } from './workloads/font-assets/authenticated-gzip';
import { loadBenchmarkFont as loadFont } from './workloads/font-assets/library';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';
import { createBenchmarkThreeRoot, disposeBenchmarkThreeRoot } from './three-root';

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
  readonly slugCanonicalLitPixels: number;
  readonly slugCoverageAtMismatchedPixels: number;
  readonly slugCoverageAtOutsideLitPixels: number;
}

/** Composed material keeps canonical position/coverage, tinting only color — proving it reuses the exported technique shader rather than reimplementing it. */
const composedMaterial = defineTextMaterial((context) => {
  if (context.kind !== 'glyph' || context.format !== bitmap.id) {
    return context.createDefaultMaterial();
  }
  const material = context.createDefaultMaterial();
  material.colorNode = context.shader.color.mul(TSL.vec3(1, 0, 0));
  return material;
});

/** Slug coverage read at the fragment's own coordinate must be the canonical integral, not an approximation of it. */
const slugCoverageAtMaterial = defineTextMaterial((context) => {
  if (context.kind !== 'glyph' || context.format !== slug.id) {
    return context.createDefaultMaterial();
  }
  const material = context.createDefaultMaterial();
  material.opacityNode = context.shader.coverageAt(context.shader.renderCoordinate);
  return material;
});

/** Two em right of any point in a glyph lies past its outline, so an integral that honours the coordinate finds no ink. */
const slugOutsideMaterial = defineTextMaterial((context) => {
  if (context.kind !== 'glyph' || context.format !== slug.id) {
    return context.createDefaultMaterial();
  }
  const material = context.createDefaultMaterial();
  material.opacityNode = context.shader.coverageAt(context.shader.renderCoordinate.add(TSL.vec2(2, 0)));
  return material;
});

window.targetV1ComposeReady = render();

async function render(): Promise<TargetV1ComposeResult> {
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  if (canvas === null) throw new Error('target-v1 compose proof canvas is missing');
  const forceWebGL = new URLSearchParams(location.search).get('backend') === 'webgl2';
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL });
  const target = new THREE.RenderTarget(256, 128, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
  const root = createBenchmarkThreeRoot('v1-compose');
  target.texture.colorSpace = THREE.NoColorSpace;
  let canonicalText: Text<typeof bitmap> | undefined;
  let composedText: Text<typeof bitmap> | undefined;
  let canonicalFont: Font<typeof bitmap> | undefined;
  let slugFont: FontFace<typeof slug> | undefined;
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

    canonicalFont = await loadFont(
      { baked: '/fixtures/rendering/inter-bitmap-16.font.glb' },
      bitmap({ strikes: [16] }),
    );
    canonicalText = root.createText({
      font: canonicalFont,
      text: 'Target v1 Bitmap',
      style: { fontSize: 28, color: '#ffffff' },
    });
    canonicalText.position.set(-112, 24, 0);
    scene.add(canonicalText);
    await renderer.renderAsync(scene, camera);
    const canonical = countPixels(await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 128));
    canonicalText.removeFromParent();
    canonicalText.dispose();
    canonicalText = undefined;

    composedText = root.createText({
      font: canonicalFont,
      text: 'Target v1 Bitmap',
      style: { fontSize: 28, color: '#ffffff' },
      material: composedMaterial,
    });
    composedText.position.set(-112, 24, 0);
    scene.add(composedText);
    await renderer.renderAsync(scene, camera);
    const composed = countPixels(await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 128));
    const drawCount =
      scene.getObjectByName('@pmndrs/glyph:v1-compose')?.children.filter((child) => child instanceof THREE.Mesh)
        .length ?? 0;
    const glyphCount = composedText.measure().glyphCount;
    composedText.removeFromParent();
    composedText.dispose();
    composedText = undefined;

    const manifest = showcaseManifest.artifacts.find((artifact) => artifact.fontFixture === 'inter');
    if (manifest === undefined) throw new Error('Slug Inter fixture manifest is missing');
    const artifact = await fetchAuthenticatedGzipAsset(interCompressedFontUrl, manifest, 'Slug font fixture');
    slugFont = glyph.fontFace(new Blob([artifact], { type: 'model/gltf-binary' }), { format: slug });
    await slugFont.load();
    const slugCanonical = await renderSlug(root, renderer, target, scene, camera, slugFont);
    const slugCoverageAt = await renderSlug(root, renderer, target, scene, camera, slugFont, slugCoverageAtMaterial);
    const slugOutside = await renderSlug(root, renderer, target, scene, camera, slugFont, slugOutsideMaterial);

    return {
      backend: renderer.backend instanceof THREE.WebGLBackend ? 'webgl2' : 'webgpu',
      drawCount,
      glyphCount,
      litPixels: composed.lit,
      redPixels: composed.red,
      greenPixels: composed.green,
      canonicalLitPixels: canonical.lit,
      canonicalGreenPixels: canonical.green,
      slugCanonicalLitPixels: countPixels(slugCanonical).lit,
      slugCoverageAtMismatchedPixels: mismatchedPixels(slugCanonical, slugCoverageAt),
      slugCoverageAtOutsideLitPixels: countPixels(slugOutside).lit,
    };
  } finally {
    canonicalText?.removeFromParent();
    canonicalText?.dispose();
    composedText?.removeFromParent();
    composedText?.dispose();
    canonicalFont?.dispose();
    slugFont?.dispose();
    disposeBenchmarkThreeRoot(root);
    target.dispose();
    renderer.dispose();
  }
}

interface PixelCounts {
  readonly lit: number;
  readonly red: number;
  readonly green: number;
}

/** Draw one Slug label alone, through `material` when given, and read back the frame. */
async function renderSlug(
  root: ThreeRoot,
  renderer: THREE.WebGPURenderer,
  target: THREE.RenderTarget,
  scene: THREE.Scene,
  camera: THREE.Camera,
  font: FontFace<typeof slug>,
  material?: ThreeTextMaterial,
): Promise<ArrayLike<number>> {
  const text = root.createText({
    font,
    text: 'Target v1 Slug',
    style: { fontSize: 28, color: '#ffffff' },
    ...(material === undefined ? {} : { material }),
  });
  try {
    text.position.set(-112, 24, 0);
    scene.add(text);
    await renderer.renderAsync(scene, camera);
    return await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 128);
  } finally {
    text.removeFromParent();
    text.dispose();
  }
}

function mismatchedPixels(expected: ArrayLike<number>, actual: ArrayLike<number>): number {
  let mismatched = 0;
  for (let offset = 0; offset < expected.length; offset += 4) {
    for (let channel = 0; channel < 4; channel += 1) {
      if (expected[offset + channel] !== actual[offset + channel]) {
        mismatched += 1;
        break;
      }
    }
  }
  return mismatched;
}

function countPixels(pixels: ArrayLike<number>): PixelCounts {
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
