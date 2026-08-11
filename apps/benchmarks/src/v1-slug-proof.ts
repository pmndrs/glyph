import type { LoadedFont } from '@pmndrs/text';
import { slug } from '@pmndrs/text/three/slug';
import { FontLoader, Text } from '@pmndrs/text/three';
import * as THREE from 'three/webgpu';
import interCompressedFontUrl from '../fixtures/rendering/inter-slug.font.glb.gz?url';
import showcaseManifest from '../fixtures/rendering/showcase-slug-fixtures-v0.json' with { type: 'json' };
import { fetchAuthenticatedGzipAsset } from './workloads/font-assets/authenticated-gzip';

declare global {
  interface Window {
    targetV1SlugReady: Promise<TargetV1SlugResult>;
  }
}

interface TargetV1SlugResult {
  readonly backend: 'webgpu' | 'webgl2';
  readonly drawCount: number;
  readonly glyphCount: number;
  readonly litPixels: number;
  readonly retainedDraw: boolean;
  readonly retainedStorage: boolean;
  readonly gpuBytes: number;
}

window.targetV1SlugReady = render();

async function render(): Promise<TargetV1SlugResult> {
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  if (canvas === null) throw new Error('target-v1 Slug proof canvas is missing');
  const forceWebGL = new URLSearchParams(location.search).get('backend') === 'webgl2';
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL });
  const loader = new FontLoader();
  const target = new THREE.RenderTarget(256, 128, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
  target.texture.colorSpace = THREE.NoColorSpace;
  let text: Text<typeof slug> | undefined;
  let font: LoadedFont<typeof slug> | undefined;
  let fontUrl: string | undefined;
  try {
    renderer.setSize(256, 128, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    await renderer.init();
    const manifest = showcaseManifest.artifacts.find((artifact) => artifact.fontFixture === 'inter');
    if (manifest === undefined) throw new Error('Slug Inter fixture manifest is missing');
    const artifact = await fetchAuthenticatedGzipAsset(interCompressedFontUrl, manifest, 'Slug font fixture');
    fontUrl = URL.createObjectURL(new Blob([artifact], { type: 'model/gltf-binary' }));
    font = await loader.loadAsync({
      input: { baked: fontUrl },
      raster: { technique: slug },
    });
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-128, 128, 64, -64, 0.1, 10);
    camera.position.z = 1;
    text = new Text({ font, text: 'Target v1 Slug', style: { fontSize: 28 }, paint: { color: '#ffffff' } });
    text.position.set(-112, 24, 0);
    scene.add(text);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    await renderer.renderAsync(scene, camera);
    const firstDraw = text.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    if (firstDraw === undefined) throw new Error('target-v1 Slug created no draw');
    const firstStorage = firstDraw.geometry.getAttribute('_pmndrsText_geometry');
    text.text = 'Target v1 Plug';
    await renderer.renderAsync(scene, camera);
    const retainedDraw = text.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 128);
    let litPixels = 0;
    for (let offset = 0; offset < pixels.length; offset += 4)
      if (pixels[offset]! > 8 || pixels[offset + 1]! > 8 || pixels[offset + 2]! > 8) litPixels += 1;
    return {
      backend: renderer.backend instanceof THREE.WebGLBackend ? 'webgl2' : 'webgpu',
      drawCount: text.children.filter((child) => child instanceof THREE.Mesh).length,
      glyphCount: text.measureLayout()?.glyphCount ?? 0,
      litPixels,
      retainedDraw: retainedDraw === firstDraw,
      retainedStorage: retainedDraw?.geometry.getAttribute('_pmndrsText_geometry') === firstStorage,
      gpuBytes: text.gpuBytes,
    };
  } finally {
    text?.removeFromParent();
    text?.dispose();
    font?.dispose();
    loader.dispose();
    target.dispose();
    renderer.dispose();
    if (fontUrl !== undefined) URL.revokeObjectURL(fontUrl);
  }
}
