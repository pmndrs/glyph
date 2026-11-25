import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import tgpu from 'typegpu';
import { bitmap, glyph, GlyphInputError, msdf } from '@pmndrs/glyph';
import { defineTypeGpuConfig } from '@pmndrs/glyph/typegpu';

globalThis.GPUBufferUsage ??= {
  MAP_READ: 1,
  MAP_WRITE: 2,
  COPY_SRC: 4,
  COPY_DST: 8,
  INDEX: 16,
  VERTEX: 32,
  UNIFORM: 64,
  STORAGE: 128,
  INDIRECT: 256,
  QUERY_RESOLVE: 512,
};
globalThis.GPUTextureUsage ??= {
  COPY_SRC: 1,
  COPY_DST: 2,
  TEXTURE_BINDING: 4,
  STORAGE_BINDING: 8,
  RENDER_ATTACHMENT: 16,
};
globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };

const bitmapFont = await readFile(
  new URL('../../../../benches/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url),
);
const msdfFont = await readFile(
  new URL('../../../../apps/r3f-hello-world/assets/inter-latin.font.glb', import.meta.url),
);
await glyph.init();

/**
 * A device that compiles nothing: TypeGPU resolves every program to WGSL and hands it to `createShaderModule`, which
 * keeps the source. Every other device object is an inert stand-in, so the real renderer runs up to the GPU.
 */
function recordingDevice() {
  const modules = [];
  const inert = {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key === 'symbol' || key === 'then') return undefined;
      return () => new Proxy({}, inert);
    },
  };
  const device = new Proxy(
    {
      features: new Set(),
      limits: { minUniformBufferOffsetAlignment: 256, minStorageBufferOffsetAlignment: 256 },
      lost: new Promise(() => {}),
      queue: new Proxy({}, inert),
      createShaderModule({ code }) {
        modules.push(code);
        return {};
      },
      createBuffer({ size, usage, mappedAtCreation }) {
        const raw = {
          size,
          usage,
          mapState: mappedAtCreation ? 'mapped' : 'unmapped',
          getMappedRange: () => new ArrayBuffer(size),
          unmap() {
            raw.mapState = 'unmapped';
          },
          destroy() {},
        };
        return new Proxy(raw, inert);
      },
    },
    inert,
  );
  const draws = [];
  const pass = {
    executeBundles() {},
    setPipeline() {},
    setBindGroup() {},
    setVertexBuffer() {},
    setIndexBuffer() {},
    draw(vertexCount, instanceCount) {
      draws.push(instanceCount);
    },
  };
  return { root: tgpu.initFromDevice({ device }), modules, draws, pass };
}

/** The vertex entry point of one compiled module, from `@vertex` to the end of its body. */
function vertexStage(code) {
  const start = code.indexOf('@vertex');
  assert.notEqual(start, -1, 'module has a vertex entry point');
  return code.slice(start, code.indexOf('\n}\n', start));
}

test('TypeGPU pixelSnapping is a construction-fixed boolean, off by default', async () => {
  const { root } = recordingDevice();
  const handle = glyph.handle('typegpu:snap-validation', defineTypeGpuConfig({ root, format: 'rgba8unorm' }));
  const font = glyph.fontFace(new Blob([bitmapFont]), { format: bitmap({ strikes: [16] }) });
  try {
    await font.load();
    assert.throws(
      () => handle.createText({ font, text: 'A', pixelSnapping: 'yes' }),
      (error) =>
        error instanceof GlyphInputError &&
        error.path.join('.') === 'pixelSnapping' &&
        /pixelSnapping must be a boolean/.test(error.message),
    );
    for (const pixelSnapping of [undefined, false, true]) {
      const text = handle.createText({ font, text: 'A', pixelSnapping });
      assert.throws(
        () => text.update({ pixelSnapping: !pixelSnapping }),
        (error) => error instanceof GlyphInputError && /pixelSnapping is fixed at construction/.test(error.message),
      );
      text.dispose();
    }
  } finally {
    font.dispose();
    handle.dispose();
  }
});

test('only a pixel-snapped Bitmap text compiles the snapped vertex stage, and it draws apart', async () => {
  const { root, modules, draws, pass } = recordingDevice();
  const handle = glyph.handle('typegpu:snap-program', defineTypeGpuConfig({ root, format: 'rgba8unorm' }));
  const bitmapFace = glyph.fontFace(new Blob([bitmapFont]), { format: bitmap({ strikes: [16] }) });
  const msdfFace = glyph.fontFace(new Blob([msdfFont]), { format: msdf });
  const viewport = { width: 640, height: 240 };
  try {
    await Promise.all([bitmapFace.load(), msdfFace.load()]);
    const unsnapped = handle.createText({ font: bitmapFace, text: 'Hi', position: [10, 10] });
    const unsnappedFalse = handle.createText({
      font: bitmapFace,
      text: 'Ho',
      position: [10, 40],
      pixelSnapping: false,
    });
    glyph.shape();
    handle.draw(pass, viewport);
    // `false` and the default are the same text: one program, one draw over both.
    assert.equal(modules.length, 1);
    assert.deepEqual(draws.splice(0), [4]);
    const plain = vertexStage(modules[0]);
    assert.doesNotMatch(modules[0], /snapClipAxis|floor\(/);
    assert.match(plain, /projectText\(bitmapQuadPosition\(/);

    // MSDF ignores the option: its program is the one an unsnapped MSDF text compiles.
    const msdfSnapped = handle.createText({ font: msdfFace, text: 'M', position: [10, 70], pixelSnapping: true });
    glyph.shape();
    handle.draw(pass, viewport);
    assert.ok(modules.length > 1);
    assert.ok(modules.slice(1).every((code) => !/snapClipAxis/.test(code)));
    draws.length = 0;
    const compiled = modules.length;

    const snapped = handle.createText({ font: bitmapFace, text: 'Ha', position: [10.37, 100.61], pixelSnapping: true });
    glyph.shape();
    handle.draw(pass, viewport);
    // The snapped Bitmap program compiles once, on the first frame that draws a snapped Bitmap text.
    assert.equal(modules.length, compiled + 1);
    const snappedStage = vertexStage(modules.at(-1));
    assert.match(snappedStage, /snappedProjectText\(bitmapQuadPosition\(/);
    assert.equal(
      snappedStage.replace('snappedProjectText(', 'projectText('),
      plain,
      'the snapped vertex stage differs from the unsnapped one only in its projection',
    );
    assert.match(
      modules.at(-1),
      /fn snapClipAxis\(clipAxis: f32, clipW: f32, physicalSize: f32\) -> f32 \{[^}]*floor\(\(physicalPosition \+ 0\.49609375f\)\)/,
    );
    assert.match(
      modules.at(-1),
      /snapClipAxis\(clip\.x, clip\.w, viewport_1\.x\), snapClipAxis\(clip\.y, clip\.w, viewport_1\.y\)/,
    );
    // Unsnapped Bitmap, the MSDF text and the snapped Bitmap text are three draws in paint order.
    assert.deepEqual(draws.splice(0), [4, 1, 2]);
    handle.draw(pass, viewport);
    assert.equal(modules.length, compiled + 1, 'later frames reuse both Bitmap programs');

    for (const text of [unsnapped, unsnappedFalse, msdfSnapped, snapped]) text.dispose();
  } finally {
    bitmapFace.dispose();
    msdfFace.dispose();
    handle.dispose();
  }
});
