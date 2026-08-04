import { FontRegistry, Text } from '@pmndrs/text';
import { bitmap } from '@pmndrs/text/raster/bitmap';
import * as THREE from 'three/webgpu';

const benchmarkIpsumPath = '/src/workloads/benchmark-ipsum.ts';
const compactRgba8ReadbackPath = '/src/benchmark/low-level/raster/rgba-readback.ts';
const rendererPath = '/src/renderer/webgpu-renderer.ts';
const [{ BENCHMARK_IPSUM_CONFORMANCE_TEXT }, { compactRgba8Readback }, { createConfiguredRenderer }] =
  await Promise.all([
    import(/* @vite-ignore */ benchmarkIpsumPath),
    import(/* @vite-ignore */ compactRgba8ReadbackPath),
    import(/* @vite-ignore */ rendererPath),
  ]);

type RendererBackend = 'webgpu' | 'webgl2';

const fontUrl = '/fixtures/rendering/inter-bitmap-16.font.glb';
const width = 384;
const height = 128;

for (const backend of ['webgpu', 'webgl2'] as const) {
  await verifyCoreTextFrame(backend);
}

async function verifyCoreTextFrame(backend: RendererBackend): Promise<void> {
  const canvas = document.createElement('canvas');
  const renderer = await createConfiguredRenderer({ backend, canvas, dpr: 1, width, height });
  const target = new THREE.RenderTarget(width, height, {
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
  });
  target.texture.colorSpace = THREE.NoColorSpace;
  target.texture.generateMipmaps = false;
  const registry = new FontRegistry();
  const response = await fetch(fontUrl);
  if (!response.ok) throw new Error(`Unable to load core Text fixture (${response.status})`);
  const font = await registry.registerAsset(new Uint8Array(await response.arrayBuffer()));
  const text = new Text({
    text: BENCHMARK_IPSUM_CONFORMANCE_TEXT,
    font,
    raster: bitmap({ strikes: [16] as const }),
    fontSize: 16,
    lineHeight: 1,
    language: 'en',
    direction: 'ltr',
    features: [],
  });
  try {
    await text.ready;
    if (text.layout?.glyphIds.length !== 137 || text.children.length !== 1) {
      throw new Error(
        `Core Text produced ${String(text.layout?.glyphIds.length)} glyphs and ${text.children.length} batches`,
      );
    }
    text.position.set(Math.max(4, (width - text.layout.width) / 2), -Math.max(4, (height - text.layout.height) / 2), 0);
    const scene = new THREE.Scene();
    scene.add(text);
    const camera = new THREE.OrthographicCamera(0, width, 0, -height, 0.1, 10);
    camera.position.z = 1;
    camera.updateProjectionMatrix();

    const full = await render(renderer, target, scene, camera, backend, width, height);
    const fullInk = inkSummary(full, width, height);
    if (fullInk.count !== 3_473 || fullInk.touchesEdge) {
      throw new Error(`${backend} core Text frame does not match the canonical unclipped ink`);
    }

    const clippedWidth = 192;
    const clippedHeight = 64;
    renderer.setSize(clippedWidth, clippedHeight, false);
    target.setSize(clippedWidth, clippedHeight);
    camera.right = clippedWidth;
    camera.bottom = -clippedHeight;
    camera.updateProjectionMatrix();
    text.position.set(-40, -4, 0);
    if (canvas.width !== clippedWidth || canvas.height !== clippedHeight) {
      throw new Error(`${backend} resize did not update the physical canvas dimensions`);
    }
    const clipped = await render(renderer, target, scene, camera, backend, clippedWidth, clippedHeight);
    const clippedInk = inkSummary(clipped, clippedWidth, clippedHeight);
    if (clippedInk.count <= 0 || clippedInk.count >= fullInk.count || !clippedInk.touchesEdge) {
      throw new Error(`${backend} core Text resize did not produce a real clipped font frame`);
    }
    console.log(
      'core-text-frame-ready',
      JSON.stringify({ backend, fullInkPixels: fullInk.count, clippedInkPixels: clippedInk.count }),
    );
  } finally {
    text.dispose();
    font.dispose();
    target.dispose();
    await renderer.dispose();
  }
}

async function render(
  renderer: THREE.WebGPURenderer,
  target: THREE.RenderTarget,
  scene: THREE.Scene,
  camera: THREE.Camera,
  backend: RendererBackend,
  renderWidth: number,
  renderHeight: number,
): Promise<Uint8Array> {
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.render(scene, camera);
  const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, renderWidth, renderHeight);
  renderer.setRenderTarget(null);
  return compactRgba8Readback(
    new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
    renderWidth,
    renderHeight,
    backend === 'webgl2' ? 'bottom-to-top' : 'top-to-bottom',
  );
}

function inkSummary(
  bytes: Uint8Array,
  renderWidth: number,
  renderHeight: number,
): { readonly count: number; readonly touchesEdge: boolean } {
  let count = 0;
  let touchesEdge = false;
  for (let pixel = 0; pixel < renderWidth * renderHeight; pixel += 1) {
    if ((bytes[pixel * 4] ?? 0) < 128) continue;
    count += 1;
    const x = pixel % renderWidth;
    const y = Math.floor(pixel / renderWidth);
    if (x === 0 || x === renderWidth - 1 || y === 0 || y === renderHeight - 1) touchesEdge = true;
  }
  return { count, touchesEdge };
}

export {};
