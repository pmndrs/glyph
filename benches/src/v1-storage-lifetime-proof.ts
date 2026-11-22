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

interface SiblingPreparation {
  readonly initial: {
    readonly backend: 'webgpu' | 'webgl2';
    readonly referencePixels: number;
    readonly bothPixels: number;
    readonly sharedAttributeName: string;
    readonly storageBefore: number;
  };
  trigger(): Promise<{
    readonly retiredDrawDisposed: boolean;
    readonly retiredHeldSharedAtDispose: boolean;
    readonly survivorRetainedDraw: boolean;
    readonly survivorRetainedStorage: boolean;
    readonly identicalSurvivorPixels: boolean;
    readonly survivorPixels: number | undefined;
    readonly storageAfter: number;
    readonly renderError: string | undefined;
  }>;
}

declare global {
  interface Window {
    targetV1StorageLifetimeReady: Promise<StorageLifetimeResult>;
    targetV1SiblingStorageReady: Promise<SiblingPreparation>;
  }
}

if (new URLSearchParams(location.search).get('scenario') === 'sibling') {
  window.targetV1SiblingStorageReady = prepareSiblingStorageLifetime();
} else {
  window.targetV1StorageLifetimeReady = proveStorageLifetime();
}

async function prepareSiblingStorageLifetime(): Promise<SiblingPreparation> {
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  if (canvas === null) throw new Error('sibling storage proof canvas is missing');
  const forceWebGL = new URLSearchParams(location.search).get('backend') === 'webgl2';
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL });
  const target = new THREE.RenderTarget(256, 128, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
  const root = createBenchmarkThreeRoot('sibling-storage');
  let fontFace: FontFace<ReturnType<typeof bitmap>> | undefined;
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
    const frame = async (): Promise<Uint8Array> => {
      await renderer.renderAsync(scene, camera);
      const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 128);
      if (!(pixels instanceof Uint8Array)) throw new Error('Three did not return RGBA8 pixels');
      return pixels;
    };
    const storageCount = (): number => {
      const count = (renderer.info.memory as typeof renderer.info.memory & { storageAttributes?: unknown })
        .storageAttributes;
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
        throw new Error('Three did not report a valid storageAttributes counter');
      }
      return count;
    };
    fontFace = glyph.fontFace('/fixtures/rendering/inter-bitmap-16.font.glb', {
      format: bitmap({ strikes: [16] }),
    });
    await fontFace.load();
    const survivorGroup = root.createTextGroup();
    const retiredGroup = root.createTextGroup();
    const survivorLabel = root.createText({
      font: fontFace,
      text: 'Surviving group',
      style: { fontSize: 28, color: '#ffffff' },
    });
    const retiredLabel = root.createText({
      font: fontFace,
      text: 'Removed group',
      style: { fontSize: 28, color: '#ffffff' },
    });
    survivorLabel.position.set(-115, -18, 0);
    retiredLabel.position.set(-115, 24, 0);
    survivorGroup.add(survivorLabel);
    retiredGroup.add(retiredLabel);
    scene.add(survivorGroup, retiredGroup);

    retiredGroup.visible = false;
    scene.updateMatrixWorld(true);
    const hiddenDraws = rootDraws(scene, 'sibling-storage');
    if (hiddenDraws.length !== 2 || hiddenDraws.filter((draw) => draw.visible).length !== 1) {
      throw new Error('automatic sibling groups did not produce one visible and one hidden draw');
    }
    const survivor = hiddenDraws.find((draw) => draw.visible)!;
    const retired = hiddenDraws.find((draw) => !draw.visible)!;
    const reference = await frame();
    const referencePixels = litPixels(reference);
    if (referencePixels < 16) throw new Error('surviving sibling reference did not render');

    retiredGroup.visible = true;
    scene.updateMatrixWorld(true);
    const shownDraws = rootDraws(scene, 'sibling-storage');
    if (shownDraws.length !== 2 || !shownDraws.includes(survivor) || !shownDraws.includes(retired)) {
      throw new Error('showing the second sibling replaced a captured draw');
    }
    const bothPixels = litPixels(await frame());
    if (bothPixels <= referencePixels) throw new Error('the second sibling did not add visible pixels');
    const shared = Object.entries(survivor.geometry.attributes).find(
      ([name, attribute]) => name.startsWith('_pmndrsGlyph') && retired.geometry.getAttribute(name) === attribute,
    );
    if (shared === undefined) throw new Error('sibling draws did not share a Glyph-owned storage attribute');
    const [sharedAttributeName, sharedAttribute] = shared;
    const storageBefore = storageCount();

    return {
      initial: {
        backend: renderer.backend instanceof THREE.WebGLBackend ? 'webgl2' : 'webgpu',
        referencePixels,
        bothPixels,
        sharedAttributeName,
        storageBefore,
      },
      async trigger() {
        let retiredDrawDisposed = false;
        let retiredHeldSharedAtDispose = false;
        retired.geometry.addEventListener('dispose', () => {
          retiredDrawDisposed = true;
          retiredHeldSharedAtDispose = retired.geometry.getAttribute(sharedAttributeName) === sharedAttribute;
        });
        try {
          retiredGroup.removeFromParent();
          scene.updateMatrixWorld(true);
          const survivingDraws = rootDraws(scene, 'sibling-storage');
          const survivorRetainedDraw = survivingDraws.length === 1 && survivingDraws[0] === survivor;
          const survivorRetainedStorage = survivor.geometry.getAttribute(sharedAttributeName) === sharedAttribute;
          let pixels: Uint8Array | undefined;
          let renderError: string | undefined;
          try {
            pixels = await frame();
          } catch (error) {
            renderError = String(error);
          }
          return {
            retiredDrawDisposed,
            retiredHeldSharedAtDispose,
            survivorRetainedDraw,
            survivorRetainedStorage,
            identicalSurvivorPixels: pixels !== undefined && reference.every((value, index) => value === pixels[index]),
            survivorPixels: pixels === undefined ? undefined : litPixels(pixels),
            storageAfter: storageCount(),
            renderError,
          };
        } finally {
          root.handle.dispose();
          fontFace?.dispose();
          target.dispose();
          renderer.dispose();
        }
      },
    };
  } catch (error) {
    root.handle.dispose();
    fontFace?.dispose();
    target.dispose();
    renderer.dispose();
    throw error;
  }
}

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

function rootDraws(scene: THREE.Scene, name = 'storage-lifetime'): THREE.Mesh[] {
  return scene.getObjectByName(`@pmndrs/glyph:${name}`)?.children.filter((child) => child instanceof THREE.Mesh) ?? [];
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
