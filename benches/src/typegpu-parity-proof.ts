// Real-device proof for the direct TypeGPU renderer: the same scenes through `@pmndrs/glyph/typegpu` and through the
// Three MSDF path at the same camera, read back as pixels, plus draw/bind-group/upload counters and frame timings.
import { bitmap, glyph, msdf, type FontFace } from '@pmndrs/glyph';
import { defineThreeConfig, type Text as ThreeText } from '@pmndrs/glyph/three';
import {
  defineTypeGpuConfig,
  type TypeGpuHandle,
  type TypeGpuText,
  type TypeGpuTextOptions,
} from '@pmndrs/glyph/typegpu';
import * as THREE from 'three/webgpu';
import tgpu, { d, std } from 'typegpu';

import devanagariFontUrl from '../fixtures/rendering/noto-sans-devanagari-mtsdf.font.glb.gz?url';
import interBitmapFontUrl from '../fixtures/rendering/inter-bitmap-16-32.font.glb?url';
import interFontUrl from '../fixtures/rendering/inter-mtsdf.font.glb.gz?url';
import showcaseManifest from '../fixtures/rendering/showcase-mtsdf-fixtures-v0.json' with { type: 'json' };
import type { Counters, ParityPerf, ParityProof } from './typegpu-parity-contract';
import { fetchAuthenticatedGzipAsset } from './workloads/font-assets/authenticated-gzip';

// A row of 832 RGBA pixels is a multiple of 256 bytes, which a texture-to-buffer copy requires.
const WIDTH = 832;
const HEIGHT = 600;

type Style = NonNullable<TypeGpuTextOptions['style']>;
type FontName = 'inter' | 'devanagari' | 'bitmap';
interface Item {
  readonly font: FontName;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly style: Style;
}
interface Scene {
  readonly items: readonly Item[];
  /** A perspective camera over a rotated plane instead of the pixel-aligned orthographic view. */
  readonly perspective?: boolean;
}
const counters = emptyCounters();
installCounters();
window.typegpuParity = start();

function emptyCounters(): Counters {
  return {
    draws: 0,
    setBindGroup: 0,
    setPipeline: 0,
    setVertexBuffer: 0,
    createBindGroup: 0,
    createBuffer: 0,
    createTexture: 0,
    createShaderModule: 0,
    createRenderPipeline: 0,
    writeBuffer: 0,
    writeBufferBytes: 0,
    writeTexture: 0,
    writeTextureBytes: 0,
    bufferBytes: 0,
    textureBytes: 0,
  };
}
function resetCounters(): void {
  Object.assign(counters, emptyCounters());
}
function snapshot(): Counters {
  return { ...counters };
}

/** Counts what the renderer asks of the device. Installed on the prototypes, so TypeGPU's own calls are seen. */
function installCounters(): void {
  type Method = (this: unknown, ...values: never[]) => unknown;
  const wrap = (prototype: object, name: string, count: (values: readonly unknown[]) => void): void => {
    const target = prototype as Record<string, Method>;
    const original = target[name]!;
    target[name] = function (this: unknown, ...values: never[]) {
      count(values);
      return original.apply(this, values);
    };
  };
  const pass = GPURenderPassEncoder.prototype;
  wrap(pass, 'draw', () => (counters.draws += 1));
  wrap(pass, 'setBindGroup', () => (counters.setBindGroup += 1));
  wrap(pass, 'setPipeline', () => (counters.setPipeline += 1));
  wrap(pass, 'setVertexBuffer', () => (counters.setVertexBuffer += 1));
  const device = GPUDevice.prototype;
  wrap(device, 'createBindGroup', () => (counters.createBindGroup += 1));
  wrap(device, 'createBuffer', ([descriptor]) => {
    counters.createBuffer += 1;
    counters.bufferBytes += (descriptor as GPUBufferDescriptor).size;
  });
  wrap(device, 'createTexture', ([descriptor]) => {
    counters.createTexture += 1;
    const { size, format } = descriptor as GPUTextureDescriptor;
    const [width, height, layers] = extent(size);
    counters.textureBytes += width * height * layers * (format === 'r8unorm' ? 1 : 4);
  });
  wrap(device, 'createShaderModule', () => (counters.createShaderModule += 1));
  wrap(device, 'createRenderPipeline', () => (counters.createRenderPipeline += 1));
  const queue = GPUQueue.prototype;
  wrap(queue, 'writeBuffer', ([, , data, , size]) => {
    counters.writeBuffer += 1;
    counters.writeBufferBytes += (size as number | undefined) ?? (data as ArrayBufferView).byteLength;
  });
  wrap(queue, 'writeTexture', ([, , , size]) => {
    counters.writeTexture += 1;
    const [width, height, layers] = extent(size as GPUExtent3D);
    counters.writeTextureBytes += width * height * layers * 4;
  });
}

const SAMPLE = 'Glyph Ag fj Wy @%';
const DEVANAGARI = 'नमस्ते दुनिया, हिन्दी क्षत्रिय';

function fxScene(only?: 'plain' | 'outline' | 'shadow' | 'both'): Scene {
  const items: Item[] = [];
  let y = 6;
  for (const size of [6, 9, 12, 16, 24, 40, 64]) {
    const outline = { color: '#ff3030', width: size / 16 };
    const thin = { color: '#ffb000', width: size / 40 };
    const near = { color: '#3060ff', offset: [size / 20, size / 24] as const };
    const far = { color: '#30c060', offset: [-size / 6, size / 5] as const };
    const add = (style: Style, column: number): void => {
      items.push({ font: 'inter', text: SAMPLE, x: 8 + size * column, y, style: { fontSize: size, ...style } });
    };
    const base = { color: '#ffffff' };
    if (only === undefined) {
      add(base, 0);
      add({ ...base, outline }, 9);
      add({ ...base, outline, shadow: near }, 18);
      add({ ...base, shadow: far }, 27);
    } else if (only === 'plain') {
      add(base, 0);
      add({ color: '#80c0ff', opacity: 0.6 }, 9);
    } else if (only === 'outline') {
      add({ ...base, outline }, 0);
      add({ ...base, outline: thin }, 9);
    } else if (only === 'shadow') {
      add({ ...base, shadow: far }, 0);
      add({ ...base, shadow: near }, 9);
    } else {
      add({ ...base, outline, shadow: near }, 0);
      add({ ...base, outline: thin, shadow: far }, 9);
    }
    y += size * 1.5 + 4;
  }
  return { items };
}

function labelScene(count: number): Scene {
  const items: Item[] = [];
  const columns = 25;
  for (let index = 0; index < count; index += 1) {
    items.push({
      font: 'inter',
      text: `Label ${String(index)}`,
      x: 2 + (index % columns) * 32,
      y: 1 + Math.floor(index / columns) * 14.9,
      style: { fontSize: 7 + (index % 5), color: '#ffffff' },
    });
  }
  return { items };
}

const scenes: Readonly<Record<string, Scene>> = {
  one: { items: [{ font: 'inter', text: 'Hello, TypeGPU!', x: 24, y: 40, style: { fontSize: 72, color: '#ffffff' } }] },
  fx: fxScene(),
  'fx-plain': fxScene('plain'),
  'fx-outline': fxScene('outline'),
  'fx-shadow': fxScene('shadow'),
  'fx-both': fxScene('both'),
  'fx-persp': { ...fxScene(), perspective: true },
  devanagari: {
    items: [14, 24, 40, 72].flatMap((size, index) => {
      const y = 10 + [0, 34, 86, 170][index]!;
      const base = { fontSize: size, color: '#ffffff', language: 'hi' } as const;
      return [
        { font: 'devanagari', text: DEVANAGARI, x: 10, y, style: base },
        {
          font: 'devanagari',
          text: DEVANAGARI,
          x: 410,
          y,
          style: {
            ...base,
            outline: { color: '#ff3030', width: size / 24 },
            shadow: { color: '#3060ff', offset: [size / 16, size / 16] },
          },
        },
      ] satisfies Item[];
    }),
  },
  labels: labelScene(1000),
  bitmap: {
    items: [
      { font: 'bitmap', text: 'Bitmap strike 16 px: Glyph Ag fj Wy', x: 10, y: 10, style: { fontSize: 16 } },
      { font: 'bitmap', text: 'Bitmap strike 32 px: Glyph Ag', x: 10, y: 40, style: { fontSize: 32 } },
      { font: 'bitmap', text: 'Scaled 24 px #80c0ff', x: 10, y: 90, style: { fontSize: 24, color: '#80c0ff' } },
      ...labelScene(200).items.map((item) => ({ ...item, font: 'bitmap' as const, y: item.y + 140 })),
    ],
  },
};

async function start(): Promise<ParityProof> {
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) throw new Error('WebGPU adapter is unavailable');
  const timestamps = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({ requiredFeatures: timestamps ? ['timestamp-query'] : [] });
  const errors: string[] = [];
  device.addEventListener('uncapturederror', (event) => errors.push(event.error.message));
  const root = tgpu.initFromDevice({ device });
  await glyph.init();

  const manifest = (fixture: string) => {
    const found = showcaseManifest.artifacts.find((artifact) => artifact.fontFixture === fixture);
    if (found === undefined) throw new Error(`MTSDF fixture manifest for ${fixture} is missing`);
    return found;
  };
  const gzipFont = async (url: string, fixture: string) =>
    new Blob([await fetchAuthenticatedGzipAsset(url, manifest(fixture), `${fixture} MTSDF fixture`)], {
      type: 'model/gltf-binary',
    });
  const fonts: Record<FontName, FontFace<typeof msdf> | FontFace<ReturnType<typeof bitmap>>> = {
    inter: glyph.fontFace(await gzipFont(interFontUrl, 'inter'), { format: msdf }),
    devanagari: glyph.fontFace(await gzipFont(devanagariFontUrl, 'noto-sans-devanagari'), { format: msdf }),
    bitmap: glyph.fontFace(interBitmapFontUrl, { format: bitmap({ strikes: [16, 32] }) }),
  };
  await Promise.all(Object.values(fonts).map((font) => font.load()));

  const format = 'rgba8unorm';
  const matrix = root.createUniform(d.mat4x4f);
  const flat = glyph.handle('typegpu-parity:flat', defineTypeGpuConfig({ root, format }));
  const projected = glyph.handle(
    'typegpu-parity:projected',
    defineTypeGpuConfig({
      root,
      format,
      transformPosition: (position) => {
        'use gpu';
        return std.mul(matrix.$, d.vec4f(position.x, -position.y, position.z, 1));
      },
    }),
  );
  const target = device.createTexture({
    size: [WIDTH, HEIGHT],
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const targetView = target.createView();
  const readback = device.createBuffer({
    size: WIDTH * HEIGHT * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const querySet = timestamps ? device.createQuerySet({ type: 'timestamp', count: 2 }) : undefined;
  const queryResolve = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  });
  const queryRead = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

  const encodeFrame = (handle: TypeGpuHandle, timed = false): GPUCommandEncoder => {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: targetView, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' }],
      ...(timed && querySet !== undefined
        ? { timestampWrites: { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } }
        : {}),
    });
    handle.draw(pass, { width: WIDTH, height: HEIGHT });
    pass.end();
    return encoder;
  };
  const frame = (handle: TypeGpuHandle): void => {
    device.queue.submit([encodeFrame(handle).finish()]);
  };
  const readPixels = async (handle: TypeGpuHandle): Promise<Uint8Array> => {
    const encoder = encodeFrame(handle);
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: WIDTH * 4 }, [WIDTH, HEIGHT]);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(readback.getMappedRange()).slice();
    readback.unmap();
    return bytes;
  };

  // Three renders into an 8-bit linear target with no output transform, so both paths store linear blends.
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
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
  const three = glyph.handle('typegpu-parity:three', defineThreeConfig({}));

  const pixelCamera = new THREE.OrthographicCamera(0, WIDTH, 0, -HEIGHT, 0.1, 10);
  pixelCamera.position.z = 1;
  const perspectiveCamera = new THREE.PerspectiveCamera(50, WIDTH / HEIGHT, 10, 4000);
  perspectiveCamera.position.set(WIDTH / 2 + 60, -HEIGHT / 2 - 40, 640);
  perspectiveCamera.lookAt(WIDTH / 2, -HEIGHT / 2, 0);

  /** The object texts are added to, in page coordinates; under perspective the page turns about its centre. */
  const page = (world: THREE.Scene, scene: Scene): THREE.Object3D => {
    if (scene.perspective !== true) return world;
    const plane = new THREE.Group();
    plane.position.set(WIDTH / 2, -HEIGHT / 2, 0);
    plane.rotation.set(-0.5, 0.45, 0.08);
    const sheet = new THREE.Group();
    sheet.position.set(-WIDTH / 2, HEIGHT / 2, 0);
    plane.add(sheet);
    world.add(plane);
    return sheet;
  };

  async function captureThree(scene: Scene): Promise<Uint8Array> {
    const world = new THREE.Scene();
    const sheet = page(world, scene);
    const texts: ThreeText<typeof msdf>[] = [];
    try {
      for (const item of scene.items) {
        const text = three.createText({
          font: fonts[item.font] as FontFace<typeof msdf>,
          text: item.text,
          style: item.style,
          layout: { wrap: 'none' },
        });
        text.position.set(item.x, -item.y, 0);
        sheet.add(text);
        texts.push(text);
      }
      const camera = scene.perspective === true ? perspectiveCamera : pixelCamera;
      glyph.shape();
      renderer.render(world, camera);
      const pixels = await renderer.readRenderTargetPixelsAsync(threeTarget, 0, 0, WIDTH, HEIGHT);
      if (scene.perspective === true) {
        world.updateMatrixWorld(true);
        const clip = new THREE.Matrix4()
          .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
          .multiply(sheet.matrixWorld);
        const e = clip.elements;
        matrix.write(
          d.mat4x4f(
            e[0]!,
            e[1]!,
            e[2]!,
            e[3]!,
            e[4]!,
            e[5]!,
            e[6]!,
            e[7]!,
            e[8]!,
            e[9]!,
            e[10]!,
            e[11]!,
            e[12]!,
            e[13]!,
            e[14]!,
            e[15]!,
          ),
        );
      }
      return new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength).slice();
    } finally {
      for (const text of texts) {
        text.removeFromParent();
        text.dispose();
      }
      glyph.shape();
    }
  }

  function mount(handle: TypeGpuHandle, scene: Scene): TypeGpuText[] {
    return scene.items.map((item) =>
      handle.createText({
        font: fonts[item.font],
        text: item.text,
        position: [item.x, item.y],
        style: item.style,
        layout: { wrap: 'none' },
      }),
    );
  }

  async function captureTypeGpu(scene: Scene): Promise<{ pixels: Uint8Array; gpuMs: number | undefined }> {
    const handle = scene.perspective === true ? projected : flat;
    const texts = mount(handle, scene);
    try {
      glyph.shape();
      const pixels = await readPixels(handle);
      return { pixels, gpuMs: await gpuPass(handle) };
    } finally {
      for (const text of texts) text.dispose();
      glyph.shape();
    }
  }

  const median = (values: number[]): number => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
  const measured = (work: () => void): Counters & { ms: number } => {
    resetCounters();
    const started = performance.now();
    work();
    const ms = performance.now() - started;
    return { ...snapshot(), ms };
  };

  /** Median render-pass time over 60 frames by timestamp query; undefined without the feature. */
  async function gpuPass(handle: TypeGpuHandle): Promise<number | undefined> {
    if (querySet === undefined) return undefined;
    const samples: number[] = [];
    for (let index = 0; index < 60; index += 1) {
      const encoder = encodeFrame(handle, true);
      encoder.resolveQuerySet(querySet, 0, 2, queryResolve, 0);
      encoder.copyBufferToBuffer(queryResolve, 0, queryRead, 0, 16);
      device.queue.submit([encoder.finish()]);
      await queryRead.mapAsync(GPUMapMode.READ);
      const [begin, end] = new BigUint64Array(queryRead.getMappedRange().slice(0));
      queryRead.unmap();
      samples.push(Number(end! - begin!) / 1e6);
    }
    return median(samples);
  }

  /** Device errors arrive asynchronously; naming the phase that just finished locates them. */
  const settle = async (phase: string): Promise<void> => {
    await device.queue.onSubmittedWorkDone();
    if (errors.length !== 0) throw new Error(`${phase}: ${errors.splice(0).join('\n')}`);
  };

  async function perf(labels: number): Promise<ParityPerf> {
    // One text is the 72 px "one" scene: the fill-bound case, where fragment cost dominates.
    const scene = labels === 1 ? scenes.one! : labelScene(labels);
    let texts: TypeGpuText[] = [];
    const mountCost = measured(() => {
      texts = mount(flat, scene);
      glyph.shape();
      frame(flat);
    });
    await settle('mount');
    try {
      for (let warm = 0; warm < 50; warm += 1) frame(flat);
      await settle('idle frames');
      resetCounters();
      frame(flat);
      const frameCounters = snapshot();

      const cpuSamples: number[] = [];
      for (let batch = 0; batch < 9; batch += 1) {
        const started = performance.now();
        for (let index = 0; index < 200; index += 1) frame(flat);
        cpuSamples.push((performance.now() - started) / 200);
        await device.queue.onSubmittedWorkDone();
      }
      const batchSamples: number[] = [];
      for (let batch = 0; batch < 9; batch += 1) {
        const started = performance.now();
        for (let index = 0; index < 100; index += 1) frame(flat);
        await device.queue.onSubmittedWorkDone();
        batchSamples.push((performance.now() - started) / 100);
      }
      const gpuFrameMs = await gpuPass(flat);

      // One label, same glyph count: alternate two strings of equal length.
      const subject = texts[Math.floor(labels / 2)]!;
      const original = scene.items[Math.floor(labels / 2)]!.text;
      const swapped = `${original.slice(0, -1)}X`;
      const editSamples: number[] = [];
      let edit = measured(() => undefined);
      for (let index = 0; index < 41; index += 1) {
        edit = measured(() => {
          subject.update({ text: index % 2 === 0 ? swapped : original });
          glyph.shape();
          frame(flat);
        });
        editSamples.push(edit.ms);
      }
      await settle('same-count edit');
      // One label, a different glyph count.
      const countSamples: number[] = [];
      let editCount = measured(() => undefined);
      for (let index = 0; index < 41; index += 1) {
        editCount = measured(() => {
          subject.update({ text: index % 2 === 0 ? `${original} more` : original });
          glyph.shape();
          frame(flat);
        });
        countSamples.push(editCount.ms);
      }
      subject.update({ text: original });
      glyph.shape();
      await settle('count-changing edit');
      // Ten labels move; nothing else changes.
      const moveSamples: number[] = [];
      let move10 = measured(() => undefined);
      for (let index = 0; index < 41; index += 1) {
        move10 = measured(() => {
          for (let moved = 0; moved < 10; moved += 1) {
            const at = Math.floor((moved * labels) / 10);
            const item = scene.items[at]!;
            texts[at]!.update({ position: [item.x + (index % 2), item.y] });
          }
          glyph.shape();
          frame(flat);
        });
        moveSamples.push(move10.ms);
      }
      await settle('move');

      // Double the label count: every capacity crossing on the way is counted.
      const added: TypeGpuText[] = [];
      resetCounters();
      for (let index = 0; index < labels; index += 1) {
        const item = scene.items[index]!;
        added.push(
          flat.createText({
            font: fonts.inter,
            text: item.text,
            position: [item.x + 3, item.y + 3],
            style: item.style,
            layout: { wrap: 'none' },
          }),
        );
        if (index % 16 === 15) {
          glyph.shape();
          frame(flat);
        }
      }
      glyph.shape();
      frame(flat);
      // A device error here is reported, not thrown: the remaining measurements stay valid.
      const growthError = await settle('growth').then(
        () => undefined,
        (error: unknown) => String(error),
      );
      const growth = { ...snapshot(), labelsAdded: added.length, error: growthError };
      for (const text of added) text.dispose();
      glyph.shape();
      frame(flat);
      await settle('removal');

      return {
        labels,
        glyphs: texts.reduce((sum, text) => sum + text.measure().glyphCount, 0),
        mount: mountCost,
        frame: frameCounters,
        cpuFrameMs: median(cpuSamples),
        gpuFrameMs,
        batchFrameMs: median(batchSamples),
        edit: { ...edit, ms: median(editSamples) },
        editCount: { ...editCount, ms: median(countSamples) },
        move10: { ...move10, ms: median(moveSamples) },
        growth,
      };
    } finally {
      for (const text of texts) text.dispose();
      glyph.shape();
      await device.queue.onSubmittedWorkDone();
    }
  }

  return {
    scenes: Object.keys(scenes),
    async capture(name, withThree) {
      const scene = scenes[name];
      if (scene === undefined) throw new RangeError(`unknown parity scene ${name}`);
      // Three first: the perspective scene takes its clip matrix from the Three camera.
      const threePixels = withThree || scene.perspective === true ? await captureThree(scene) : undefined;
      const typegpu = await captureTypeGpu(scene);
      if (errors.length !== 0) throw new Error(errors.splice(0).join('\n'));
      return {
        width: WIDTH,
        height: HEIGHT,
        typegpu: base64(typegpu.pixels),
        three: withThree && threePixels !== undefined ? base64(threePixels) : undefined,
        gpuMs: typegpu.gpuMs,
      };
    },
    async perf(labels) {
      const result = await perf(labels);
      if (errors.length !== 0) throw new Error(errors.splice(0).join('\n'));
      return result;
    },
    async toPng(rgba, width, height) {
      const surface = new OffscreenCanvas(width, height);
      const context = surface.getContext('2d')!;
      context.putImageData(new ImageData(new Uint8ClampedArray(unbase64(rgba)), width, height), 0, 0);
      const blob = await surface.convertToBlob({ type: 'image/png' });
      return base64(new Uint8Array(await blob.arrayBuffer()));
    },
    async fromPng(png) {
      const bitmapImage = await createImageBitmap(new Blob([unbase64(png)], { type: 'image/png' }), {
        colorSpaceConversion: 'none',
        premultiplyAlpha: 'none',
      });
      const surface = new OffscreenCanvas(bitmapImage.width, bitmapImage.height);
      const context = surface.getContext('2d')!;
      context.drawImage(bitmapImage, 0, 0);
      return base64(new Uint8Array(context.getImageData(0, 0, bitmapImage.width, bitmapImage.height).data.buffer));
    },
  };
}

function extent(size: GPUExtent3D): [number, number, number] {
  if (Symbol.iterator in size) {
    const [width = 1, height = 1, layers = 1] = size;
    return [width, height, layers];
  }
  return [size.width, size.height ?? 1, size.depthOrArrayLayers ?? 1];
}
function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}
function unbase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
