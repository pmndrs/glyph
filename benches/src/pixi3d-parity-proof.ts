// Real-device proof for `@pmndrs/glyph/pixi3d`: the same scenes through PixiJS 3D (WebGPU or WebGL2, from `?backend=`)
// and through Glyph's Three renderer on WebGPU, at the same camera, read back as pixels.
import { Container3D, FlatMaterial, View3D } from '@pixi/3d';
import { bitmap, glyph, msdf, slug, type FontFace } from '@pmndrs/glyph';
import { definePixi3DConfig, Pixi3DTextMaterial, type Pixi3DText } from '@pmndrs/glyph/pixi3d';
import { defineThreeConfig } from '@pmndrs/glyph/three';
import { Application } from 'pixi.js';
import * as THREE from 'three/webgpu';

import devanagariBitmapUrl from '../fixtures/rendering/noto-sans-devanagari-bitmap-16-32.font.glb?url';
import devanagariMsdfUrl from '../fixtures/rendering/noto-sans-devanagari-mtsdf.font.glb.gz?url';
import devanagariSlugUrl from '../fixtures/rendering/noto-sans-devanagari-slug.font.glb.gz?url';
import interBitmapUrl from '../fixtures/rendering/inter-bitmap-16-32.font.glb?url';
import interMsdfUrl from '../fixtures/rendering/inter-mtsdf.font.glb.gz?url';
import interSlugUrl from '../fixtures/rendering/inter-slug.font.glb.gz?url';
import msdfManifest from '../fixtures/rendering/showcase-mtsdf-fixtures-v0.json' with { type: 'json' };
import slugManifest from '../fixtures/rendering/showcase-slug-fixtures-v0.json' with { type: 'json' };
import type { Pixi3DBackend, Pixi3DParityProof } from './pixi3d-parity-contract';
import { SNAPPED_ROWS } from './snapped-bitmap-rows';
import { fetchAuthenticatedGzipAsset } from './workloads/font-assets/authenticated-gzip';

const WIDTH = 832;
const HEIGHT = 600;

type Technique = 'msdf' | 'slug' | 'bitmap';
type Script = 'latin' | 'devanagari';
type Style = NonNullable<Parameters<Pixi3DText['update']>[0]['style']>;
interface Item {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly style: Style;
  readonly script?: Script;
  /** Paragraph width; omitted items do not wrap. */
  readonly width?: number;
}
interface Scene {
  readonly technique: Technique;
  readonly items: readonly Item[];
  /** A perspective camera over a rotated page instead of the pixel-aligned orthographic view. */
  readonly perspective?: boolean;
  /** Pixi only: mount this many items and draw, then add the rest 16 at a time with a shape and a frame each. */
  readonly grownFrom?: number;
  /** Pixi only: mount each item with its first character, then reveal it over 6 shaped frames. */
  readonly arriving?: boolean;
  /** Pixi only: mount every item as `Label <index>`, draw, then set the scene's text and draw again. */
  readonly edited?: boolean;
  /** Pixi only: mount each item at this paragraph width, draw, then set the scene's width and draw again. */
  readonly widenedFrom?: number;
  /** Both renderers sample Bitmap pages with the nearest texel (`bitmapFilter: 'nearest'`). */
  readonly nearest?: boolean;
  /** Every text of both renderers is constructed with `pixelSnapping: true`. */
  readonly snapped?: boolean;
}

const backend: Pixi3DBackend = new URLSearchParams(location.search).get('backend') === 'webgl' ? 'webgl' : 'webgpu';
window.pixi3dParity = start();

const SAMPLE = 'Glyph Ag fj Wy @%';
const DEVANAGARI = 'नमस्ते दुनिया, हिन्दी क्षत्रिय';
const PARAGRAPH =
  'Glyph shapes, breaks and positions text once, and every renderer draws the same glyph records. ' +
  'This paragraph wraps at its constraint width, so a width change moves whole words between lines.';

function sizes(technique: Technique, script: Script = 'latin'): Scene {
  const text = script === 'devanagari' ? DEVANAGARI : SAMPLE;
  const steps = technique === 'bitmap' ? [16, 24, 32, 48, 64] : [6, 9, 12, 16, 24, 40, 64];
  const items: Item[] = [];
  let y = 6;
  const language = script === 'devanagari' ? { language: 'hi' } : {};
  // One row per text: overlapping translucent texts would compare the engines' draw-order rules, not their glyphs.
  for (const size of steps) {
    items.push({ text, x: 8, y, script, style: { fontSize: size, color: '#ffffff', ...language } });
    y += size * 1.2 + 2;
    items.push({ text, x: 8, y, script, style: { fontSize: size, color: '#80c0ff', opacity: 0.6, ...language } });
    y += size * 1.2 + 2;
  }
  return { technique, items };
}

function effects(): Scene {
  const items: Item[] = [];
  let y = 6;
  for (const size of [9, 16, 24, 40, 64]) {
    items.push({
      text: SAMPLE,
      x: 8,
      y,
      style: { fontSize: size, color: '#ffffff', outline: { color: '#ff3030', width: size / 16 } },
    });
    y += size * 1.2 + 4;
    items.push({
      text: SAMPLE,
      x: 8,
      y,
      style: { fontSize: size, color: '#ffffff', shadow: { color: '#3060ff', offset: [size / 20, size / 24] } },
    });
    y += size * 1.2 + 4;
  }
  return { technique: 'msdf', items };
}

function labels(technique: Technique, count = 200): Scene {
  return {
    technique,
    items: Array.from({ length: count }, (_, index) => ({
      text: `Label ${String(index)}`,
      x: 2 + (index % 25) * 32,
      y: 1 + Math.floor(index / 25) * 14.9,
      style: { fontSize: technique === 'bitmap' ? 16 : 7 + (index % 5), color: '#ffffff' },
    })),
  };
}

function paragraph(technique: Technique, width: number): Scene {
  return {
    technique,
    items: [16, 24].map((size, index) => ({
      text: PARAGRAPH,
      x: 12,
      y: 12 + index * 220,
      width,
      style: { fontSize: size, color: '#ffffff' },
    })),
  };
}

function arriving(technique: Technique): Scene {
  const lines = [
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'abcdefghijklmnopqrstuvwxyz',
    '0123456789 !"#$%&\'()*+,-./:;<=>?@[]^_`{|}~',
  ];
  const items: Item[] = [];
  let y = 6;
  for (const size of technique === 'bitmap' ? [16, 32] : [14, 22, 34]) {
    for (const text of lines) {
      items.push({ text, x: 8, y, style: { fontSize: size, color: '#ffffff' } });
      y += size * 1.2 + 2;
    }
  }
  return { technique, items, arriving: true };
}

function grown(technique: Technique): Scene {
  return { ...labels(technique, 400), grownFrom: 40 };
}

function edited(technique: Technique): Scene {
  return {
    ...labels(technique),
    items: labels(technique).items.map((item, index) =>
      index % 3 === 0 ? { ...item, text: `Edit ${String(index)}` } : item,
    ),
    edited: true,
  };
}

/**
 * Strikes at their own sizes (1:1), on whole-pixel positions and at fractional ones, some underlined: snapping rounds
 * every glyph quad and decoration corner onto the pixel grid, so both filters read whole texels.
 */
function snapped(nearest: boolean): Scene {
  const items: Item[] = [];
  for (const { x: left, y } of SNAPPED_ROWS) {
    items.push({
      text: 'Snapped 16 px: Glyph Ag fj Wy',
      x: left,
      y,
      style: { fontSize: 16, color: '#ffffff' },
    });
    items.push({ text: 'Snapped 32 px: Ag', x: left, y: y + 24, style: { fontSize: 32, color: '#ffffff' } });
    items.push({
      text: 'Underlined 0123',
      x: left + 410,
      y,
      // White decorations: PixiJS 3D's decoration material encodes its paint for display (the package's lit default),
      // which the proof's unlit display-space text material does not, so only full-intensity paint stores alike.
      style: { fontSize: 16, color: '#80c0ff', decoration: { underline: true, color: '#ffffff' } },
    });
    items.push({
      text: 'Struck 32',
      x: left + 410,
      y: y + 24,
      style: { fontSize: 32, color: '#ffffff', opacity: 0.6, decoration: { lineThrough: true } },
    });
  }
  return { technique: 'bitmap', items, snapped: true, nearest };
}

const scenes: Readonly<Record<string, Scene>> = {
  'msdf-sizes': sizes('msdf'),
  'msdf-effects': effects(),
  'msdf-paragraph': paragraph('msdf', 380),
  'msdf-labels': labels('msdf'),
  'msdf-devanagari': sizes('msdf', 'devanagari'),
  'msdf-arriving': arriving('msdf'),
  'msdf-grown': grown('msdf'),
  'msdf-edit': edited('msdf'),
  'msdf-width': { ...paragraph('msdf', 520), widenedFrom: 260 },
  'msdf-persp': { ...sizes('msdf'), perspective: true },
  'slug-sizes': sizes('slug'),
  'slug-paragraph': paragraph('slug', 380),
  'slug-labels': labels('slug'),
  'slug-devanagari': sizes('slug', 'devanagari'),
  'slug-arriving': arriving('slug'),
  'slug-grown': grown('slug'),
  'slug-edit': edited('slug'),
  'slug-width': { ...paragraph('slug', 520), widenedFrom: 260 },
  'slug-persp': { ...sizes('slug'), perspective: true },
  'bitmap-sizes': sizes('bitmap'),
  'bitmap-paragraph': paragraph('bitmap', 380),
  'bitmap-labels': labels('bitmap'),
  'bitmap-devanagari': sizes('bitmap', 'devanagari'),
  'bitmap-arriving': arriving('bitmap'),
  'bitmap-grown': grown('bitmap'),
  'bitmap-edit': edited('bitmap'),
  'bitmap-width': { ...paragraph('bitmap', 520), widenedFrom: 260 },
  // The sizes scene read texel by texel. Nearest sampling picks a texel by convention where a pixel centre lies
  // exactly on a texel edge (Three's WebGPU texel load floors, a sampler rounds in fixed point), and these strikes'
  // quads sit on half pixels, so each row starts on a whole pixel moved 0.3 px, off texel edges at 1x, 1.5x and 2x.
  // Named apart from `bitmap-*`: snapped quads own whole pixels, so WebGL's pixel-centre edge budget does not apply.
  'snapped-bitmap': snapped(false),
  'snapped-bitmap-nearest': snapped(true),
  'bitmap-nearest': {
    ...sizes('bitmap'),
    items: sizes('bitmap').items.map((item) => ({ ...item, x: item.x + 0.3, y: Math.round(item.y) + 0.3 })),
    nearest: true,
  },
};

async function start(): Promise<Pixi3DParityProof> {
  await glyph.init();
  const gzip = async (url: string, manifest: typeof msdfManifest | typeof slugManifest, fixture: string) => {
    const artifact = manifest.artifacts.find((candidate) => candidate.fontFixture === fixture);
    if (artifact === undefined) throw new Error(`fixture manifest for ${fixture} is missing`);
    return new Blob([await fetchAuthenticatedGzipAsset(url, artifact, `${fixture} fixture`)], {
      type: 'model/gltf-binary',
    });
  };
  type AnyFace = FontFace<typeof msdf> | FontFace<typeof slug> | FontFace<ReturnType<typeof bitmap>>;
  const fonts: Record<Technique, Record<Script, AnyFace>> = {
    msdf: {
      latin: glyph.fontFace(await gzip(interMsdfUrl, msdfManifest, 'inter'), { format: msdf }),
      devanagari: glyph.fontFace(await gzip(devanagariMsdfUrl, msdfManifest, 'noto-sans-devanagari'), { format: msdf }),
    },
    slug: {
      latin: glyph.fontFace(await gzip(interSlugUrl, slugManifest, 'inter'), { format: slug }),
      devanagari: glyph.fontFace(await gzip(devanagariSlugUrl, slugManifest, 'noto-sans-devanagari'), { format: slug }),
    },
    bitmap: {
      latin: glyph.fontFace(interBitmapUrl, { format: bitmap({ strikes: [16, 32] }) }),
      devanagari: glyph.fontFace(devanagariBitmapUrl, { format: bitmap({ strikes: [16, 32] }) }),
    },
  };
  await Promise.all(Object.values(fonts).flatMap((faces) => Object.values(faces).map((font) => font.load())));
  const fontOf = (scene: Scene, item: Item) => fonts[scene.technique][item.script ?? 'latin'];

  // Three: an 8-bit linear target with no output transform, as in the TypeGPU parity proof.
  const threeCanvas = document.querySelector<HTMLCanvasElement>('#three')!;
  const renderer = new THREE.WebGPURenderer({ canvas: threeCanvas, antialias: false });
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  await renderer.init();
  const threeTarget = new THREE.RenderTarget(WIDTH, HEIGHT, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
  });
  threeTarget.texture.colorSpace = THREE.NoColorSpace;
  renderer.setRenderTarget(threeTarget);
  renderer.setClearColor(0x000000, 1);
  const threeHandle = glyph.handle('pixi3d-parity:three', defineThreeConfig({}));
  const threeNearest = glyph.handle('pixi3d-parity:three-nearest', defineThreeConfig({ bitmapFilter: 'nearest' }));
  const pixelCamera = new THREE.OrthographicCamera(0, WIDTH, 0, -HEIGHT, 0.1, 10);
  pixelCamera.position.z = 1;
  const perspectiveCamera = new THREE.PerspectiveCamera(50, WIDTH / HEIGHT, 10, 4000);
  perspectiveCamera.position.set(WIDTH / 2 + 60, -HEIGHT / 2 - 40, 640);
  perspectiveCamera.lookAt(WIDTH / 2, -HEIGHT / 2, 0);

  // PixiJS 3D: no MSAA, the same cameras, and an unlit material in display space, so the stored value is the same
  // linear blend Three stores. The package's default lit PBR material has no unlit Three counterpart.
  const app = new Application();
  await app.init({
    canvas: document.querySelector<HTMLCanvasElement>('#pixi')!,
    width: WIDTH,
    height: HEIGHT,
    preference: backend,
    antialias: false,
    resolution: 1,
    autoStart: false,
    background: 0x000000,
    preserveDrawingBuffer: true,
  });
  if (app.renderer.name !== backend) throw new Error(`PixiJS chose ${app.renderer.name}, not ${backend}`);
  const view = new View3D({ width: WIDTH, height: HEIGHT, background: 0x000000, toneMapping: 'none' });
  app.stage.addChild(view);
  const pixiHandle = glyph.handle('pixi3d-parity:pixi', definePixi3DConfig());
  const pixiNearest = glyph.handle('pixi3d-parity:pixi-nearest', definePixi3DConfig({ bitmapFilter: 'nearest' }));
  const unlit = new Pixi3DTextMaterial({
    shared: true,
    nativeRecords: true,
    create: ({ bits }) => new FlatMaterial({ alphaMode: 'blend', doubleSided: true, fog: false, extraBits: bits }),
  });

  const textOptions = (scene: Scene, item: Item, text = item.text, width = item.width) => ({
    font: fontOf(scene, item),
    text,
    style: item.style,
    ...(scene.snapped === true ? { pixelSnapping: true } : {}),
    ...(width === undefined
      ? { layout: { wrap: 'none' as const } }
      : { constraints: { width: { mode: 'at-most' as const, size: width } } }),
  });

  function threePage(world: THREE.Scene, scene: Scene): THREE.Object3D {
    if (scene.perspective !== true) return world;
    const plane = new THREE.Group();
    plane.position.set(WIDTH / 2, -HEIGHT / 2, 0);
    plane.rotation.set(-0.5, 0.45, 0.08);
    const sheet = new THREE.Group();
    sheet.position.set(-WIDTH / 2, HEIGHT / 2, 0);
    plane.add(sheet);
    world.add(plane);
    return sheet;
  }

  async function captureThree(scene: Scene): Promise<Uint8Array> {
    const world = new THREE.Scene();
    const sheet = threePage(world, scene);
    const texts: { removeFromParent(): unknown; dispose(): void }[] = [];
    try {
      for (const item of scene.items) {
        const handle = scene.nearest === true ? threeNearest : threeHandle;
        const text = handle.createText(textOptions(scene, item) as Parameters<typeof handle.createText>[0]);
        text.position.set(item.x, -item.y, 0);
        sheet.add(text);
        texts.push(text);
      }
      glyph.shape();
      renderer.render(world, scene.perspective === true ? perspectiveCamera : pixelCamera);
      const pixels = await renderer.readRenderTargetPixelsAsync(threeTarget, 0, 0, WIDTH, HEIGHT);
      return new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength).slice();
    } finally {
      for (const text of texts) {
        text.removeFromParent();
        text.dispose();
      }
      glyph.shape();
    }
  }

  function pixiPage(scene: Scene): { root: Container3D; sheet: Container3D } {
    const root = new Container3D();
    view.root.addChild(root);
    const camera = view.camera;
    if (scene.perspective !== true) {
      camera.useOrthographic(WIDTH / 2, 0.1, 10);
      camera.position.set(WIDTH / 2, -HEIGHT / 2, 1);
      // A perspective scene aimed the camera with lookAt, which writes its quaternion: reset that, not the Euler.
      camera.quaternion.identity();
      return { root, sheet: root };
    }
    camera.usePerspective(50, 10, 4000);
    camera.position.set(WIDTH / 2 + 60, -HEIGHT / 2 - 40, 640);
    camera.lookAt({ x: WIDTH / 2, y: -HEIGHT / 2, z: 0 });
    const plane = new Container3D();
    plane.position.set(WIDTH / 2, -HEIGHT / 2, 0);
    plane.rotation.set(-0.5, 0.45, 0.08);
    const sheet = new Container3D();
    sheet.position.set(-WIDTH / 2, HEIGHT / 2, 0);
    plane.addChild(sheet);
    root.addChild(plane);
    return { root, sheet };
  }

  /** Draws one frame and reads the canvas back in the same task, before the swap chain can present it. */
  function pixiFrame(): Uint8Array {
    app.render();
    const surface = new OffscreenCanvas(WIDTH, HEIGHT);
    const context = surface.getContext('2d', { colorSpace: 'srgb' })!;
    context.drawImage(app.canvas, 0, 0);
    return new Uint8Array(context.getImageData(0, 0, WIDTH, HEIGHT).data.buffer);
  }

  function capturePixi(scene: Scene): { pixels: Uint8Array; meshes: number } {
    const { root, sheet } = pixiPage(scene);
    const texts: Pixi3DText[] = [];
    const mount = (items: readonly Item[]) => {
      for (const item of items) {
        const index = texts.length;
        const text =
          scene.arriving === true
            ? item.text.slice(0, 1)
            : scene.edited === true
              ? `Label ${String(index)}`
              : item.text;
        const handle = scene.nearest === true ? pixiNearest : pixiHandle;
        const created = handle.createText({
          ...textOptions(scene, item, text, scene.widenedFrom ?? item.width),
          material: unlit,
        } as Parameters<typeof handle.createText>[0]);
        created.position.set(item.x, -item.y, 0);
        sheet.addChild(created);
        texts.push(created);
      }
    };
    try {
      mount(scene.items.slice(0, scene.grownFrom));
      glyph.shape();
      pixiFrame();
      if (scene.grownFrom !== undefined) {
        for (let from = scene.grownFrom; from < scene.items.length; from += 16) {
          mount(scene.items.slice(from, from + 16));
          glyph.shape();
          pixiFrame();
        }
      }
      if (scene.arriving === true) {
        for (let step = 1; step <= 6; step += 1) {
          for (const [index, item] of scene.items.entries()) {
            texts[index]!.text = item.text.slice(0, Math.ceil((item.text.length * step) / 6));
          }
          glyph.shape();
          pixiFrame();
        }
      }
      if (scene.edited === true) {
        for (const [index, item] of scene.items.entries()) texts[index]!.text = item.text;
        glyph.shape();
      }
      if (scene.widenedFrom !== undefined) {
        for (const [index, item] of scene.items.entries()) {
          texts[index]!.constraints = { width: { mode: 'at-most', size: item.width! } };
        }
        glyph.shape();
      }
      const meshes = texts.reduce((count, text) => count + text.children.length, 0);
      return { pixels: pixiFrame(), meshes };
    } finally {
      for (const text of texts) text.dispose();
      root.destroy({ children: true });
      glyph.shape();
    }
  }

  return {
    backend,
    scenes: Object.keys(scenes),
    async capture(name) {
      const scene = scenes[name];
      if (scene === undefined) throw new Error(`unknown scene ${name}`);
      const pixi = capturePixi(scene);
      const three = await captureThree(scene);
      return { width: WIDTH, height: HEIGHT, pixi: base64(pixi.pixels), three: base64(three), meshes: pixi.meshes };
    },
    async toPng(rgba, width, height) {
      const surface = new OffscreenCanvas(width, height);
      surface.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(unbase64(rgba)), width, height), 0, 0);
      const blob = await surface.convertToBlob({ type: 'image/png' });
      return base64(new Uint8Array(await blob.arrayBuffer()));
    },
  };
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function unbase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
}
