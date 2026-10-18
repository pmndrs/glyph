import { bitmap, glyph, type FontFace } from '@pmndrs/glyph';
import { defineTextMaterial } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';
import { createBenchmarkThreeRoot } from './three-root';

interface StorageLifetimeResult {
  readonly backend: 'webgpu' | 'webgl2';
  readonly baseline: number;
  readonly firstDraw: number;
  readonly firstEmpty: number;
  readonly revivedDraw: number;
  readonly finalEmpty: number;
  readonly finalDisposed: number;
  readonly firstEmptyBytes: number;
  readonly firstGeometryAttributes: readonly string[];
  readonly retiredGeometryAttributes: readonly string[];
  readonly reusedTransformAttribute: boolean;
  readonly identicalRevivedPixels: boolean;
  readonly firstDrawPixels: number;
  readonly revivedDrawPixels: number;
  readonly firstEmptyPixels: number;
  readonly finalEmptyPixels: number;
  readonly secondaryDraw?: number;
  readonly secondaryDisposed?: number;
  readonly secondaryDisposedBeforeOwner?: boolean;
}

declare global {
  interface Window {
    targetV1StorageLifetimeReady: Promise<StorageLifetimeResult>;
  }
}

window.targetV1StorageLifetimeReady = proveStorageLifetime();

async function proveStorageLifetime(): Promise<StorageLifetimeResult> {
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  if (canvas === null) throw new Error('storage lifetime proof canvas is missing');
  const forceWebGL = new URLSearchParams(location.search).get('backend') === 'webgl2';
  const scenario = new URLSearchParams(location.search).get('scenario');
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL });
  const target = new THREE.RenderTarget(256, 128, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
  const root = createBenchmarkThreeRoot('storage-lifetime');
  let fontFace: FontFace<ReturnType<typeof bitmap>> | undefined;
  let secondaryRenderer: THREE.WebGPURenderer | undefined;
  let secondaryTarget: THREE.RenderTarget | undefined;
  try {
    renderer.setSize(256, 128, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 1);
    await renderer.init();
    renderer.setRenderTarget(target);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-128, 128, 64, -64, 0.1, 10);
    camera.position.z = 1;
    const storageCount = (): number => {
      const count = (renderer.info.memory as typeof renderer.info.memory & { storageAttributes?: unknown })
        .storageAttributes;
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
        throw new Error('Three did not report a valid storageAttributes counter');
      }
      return count;
    };
    const frame = async (): Promise<Uint8Array> => {
      await renderer.renderAsync(scene, camera);
      const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 128);
      if (!(pixels instanceof Uint8Array)) throw new Error('Three did not return RGBA8 pixels');
      return pixels;
    };
    await frame();
    const baseline = storageCount();

    fontFace = glyph.fontFace('/fixtures/rendering/inter-bitmap-16.font.glb', {
      format: bitmap({ strikes: [16] }),
    });
    await fontFace.load();
    const group = root.createTextGroup();
    const label = root.createText({
      font: fontFace,
      text: 'Storage lifetime',
      style: { fontSize: 28, color: '#ffffff' },
    });
    label.position.set(-115, 0, 0);
    group.add(label);
    scene.add(group);
    const firstPixels = await frame();
    const firstDraw = storageCount();
    const firstGeometry = rootDraws(scene)[0]!.geometry;
    const firstGeometryAttributes = Object.keys(firstGeometry.attributes);
    const originalTransform = drawTransform(scene);
    if (!(originalTransform instanceof THREE.BufferAttribute)) {
      throw new Error('first publication did not produce an indexed transform attribute');
    }

    group.removeFromParent();
    scene.updateMatrixWorld(true);
    const emptyImage = await frame();
    const firstEmpty = storageCount();
    const firstEmptyBytes = (renderer.info.memory as typeof renderer.info.memory & { storageAttributesSize: number })
      .storageAttributesSize;
    const retiredGeometryAttributes = Object.keys(firstGeometry.attributes);
    if (rootDraws(scene).length !== 0) throw new Error('empty publication retained a draw');

    scene.add(group);
    const revivedPixels = await frame();
    const revivedDraw = storageCount();
    const reusedTransformAttribute = drawTransform(scene) === originalTransform;
    const identicalRevivedPixels = firstPixels.every((value, index) => value === revivedPixels[index]);
    let secondaryDraw: number | undefined;
    if (scenario === 'multi' || scenario === 'renderer-disposed-first') {
      secondaryRenderer = new THREE.WebGPURenderer({
        canvas: document.createElement('canvas'),
        antialias: false,
        forceWebGL,
      });
      secondaryTarget = new THREE.RenderTarget(256, 128, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
      secondaryRenderer.setSize(256, 128, false);
      secondaryRenderer.setPixelRatio(1);
      secondaryRenderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      secondaryRenderer.toneMapping = THREE.NoToneMapping;
      await secondaryRenderer.init();
      secondaryRenderer.setRenderTarget(secondaryTarget);
      await secondaryRenderer.renderAsync(scene, camera);
      secondaryDraw = secondaryRenderer.info.memory.storageAttributes;
    }

    const renderedDraw = rootDraws(scene)[0];
    label.material = defineTextMaterial((context) => context.createDefaultMaterial());
    scene.updateMatrixWorld(true);
    const unrenderedReplacement = rootDraws(scene)[0];
    if (unrenderedReplacement === undefined || unrenderedReplacement === renderedDraw) {
      throw new Error('material change did not replace the rendered draw');
    }
    if (drawTransform(scene) !== originalTransform) {
      throw new Error('material change replaced the retained transform storage');
    }
    if (scenario === 'compile') await renderer.compileAsync(scene, camera);

    group.removeFromParent();
    scene.updateMatrixWorld(true);
    const finalEmptyImage = await frame();
    const finalEmpty = storageCount();
    if (scenario === 'renderer-disposed-first') secondaryRenderer?.dispose();
    root.handle.dispose();
    await frame();
    const finalDisposed = storageCount();
    let secondaryDisposed: number | undefined;
    if (scenario === 'multi' && secondaryRenderer !== undefined) {
      await secondaryRenderer.renderAsync(scene, camera);
      secondaryDisposed = secondaryRenderer.info.memory.storageAttributes;
    }

    return {
      backend: renderer.backend instanceof THREE.WebGLBackend ? 'webgl2' : 'webgpu',
      baseline,
      firstDraw,
      firstEmpty,
      revivedDraw,
      finalEmpty,
      finalDisposed,
      firstEmptyBytes,
      firstGeometryAttributes,
      retiredGeometryAttributes,
      reusedTransformAttribute,
      identicalRevivedPixels,
      firstDrawPixels: litPixels(firstPixels),
      revivedDrawPixels: litPixels(revivedPixels),
      firstEmptyPixels: litPixels(emptyImage),
      finalEmptyPixels: litPixels(finalEmptyImage),
      ...(secondaryDraw === undefined ? {} : { secondaryDraw }),
      ...(secondaryDisposed === undefined ? {} : { secondaryDisposed }),
      ...(scenario !== 'renderer-disposed-first' ? {} : { secondaryDisposedBeforeOwner: true }),
    };
  } finally {
    root.handle.dispose();
    fontFace?.dispose();
    secondaryTarget?.dispose();
    secondaryRenderer?.dispose();
    target.dispose();
    renderer.dispose();
  }
}

function rootDraws(scene: THREE.Scene): THREE.Mesh[] {
  return (
    scene.getObjectByName('@pmndrs/glyph:storage-lifetime')?.children.filter((child) => child instanceof THREE.Mesh) ??
    []
  );
}

function drawTransform(scene: THREE.Scene): THREE.BufferAttribute | undefined {
  const attribute = rootDraws(scene)[0]?.geometry.getAttribute('_pmndrsGlyphTransforms');
  return attribute instanceof THREE.BufferAttribute ? attribute : undefined;
}

function litPixels(pixels: Uint8Array): number {
  let lit = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index]! > 0 || pixels[index + 1]! > 0 || pixels[index + 2]! > 0) lit += 1;
  }
  return lit;
}
