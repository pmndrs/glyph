import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { glyph } from '@pmndrs/glyph';
import { defineTypeGpuConfig } from '@pmndrs/glyph/typegpu';
import { resourceLease } from '@pmndrs/glyph/config/glyph';
import { msdf, msdfSchema } from '@pmndrs/glyph/raster/msdf';

const fontBytes = await readFile(
  new URL('../../../../apps/r3f-hello-world/assets/inter-latin.font.glb', import.meta.url),
);
globalThis.GPUBufferUsage ??= { VERTEX: 32, COPY_DST: 8 };
await glyph.init();

// A recording host at the public config seam. The real engine authors all commands and bytes.
function recordingHost() {
  const allocations = new Set();
  const recorded = [];
  const uploads = [];
  const stats = { allocations: 0, preparations: 0, reject: false };
  function buffer(size) {
    const value = {
      bytes: new Uint8Array(size),
      destroyed: false,
      destroy() {
        this.destroyed = true;
        allocations.delete(this);
      },
    };
    allocations.add(value);
    return value;
  }
  const root = {
    createUniform() {
      const allocation = buffer(8);
      return {
        buffer: allocation,
        value: [0, 0],
        write(value) {
          this.value = [...value];
        },
      };
    },
    device: {
      createBuffer({ size }) {
        stats.allocations++;
        return buffer(size);
      },
      queue: {
        writeBuffer(target, offset, bytes) {
          uploads.push({ offset, length: bytes.byteLength, capacity: target.bytes.byteLength });
          target.bytes.set(bytes, offset);
        },
      },
    },
  };
  const base = defineTypeGpuConfig({ root, format: 'rgba8unorm' });
  const config = {
    ...base,
    renderer: ({ defaultRenderer }) => ({
      decode(frame) {
        const prepared = defaultRenderer.decode(frame);
        if (stats.reject) {
          prepared.discard();
          throw new Error('Injected renderer rejection');
        }
        return prepared;
      },
      syncTransforms: () => defaultRenderer.syncTransforms(),
      dispose: () => defaultRenderer.dispose(),
    }),
    resolve: () =>
      resourceLease(
        {
          prepare(buffers, viewport, position, start, count) {
            stats.preparations++;
            return {
              draw() {
                recorded.push({
                  // Compare raster inputs, not lifecycle-specific stable glyph identities.
                  buffers: Object.values(msdfSchema.buffers).map((declaration) => {
                    const stride = declaration.lanes.length * 4;
                    return buffers.get(declaration.id).bytes.slice(start * stride, (start + count) * stride);
                  }),
                  position: [...position.value],
                  viewport: [...viewport.value],
                  start,
                  count,
                });
              },
            };
          },
        },
        () => {},
      ),
  };
  return { config, allocations, recorded, uploads, stats };
}

test('localized TypeGPU edits retain GPU buffers and discard leaves accepted bytes untouched', async (t) => {
  const host = recordingHost();
  const handle = glyph.handle('typegpu:incremental', host.config);
  const font = glyph.fontFace(new Blob([fontBytes]), { format: msdf });
  const prefix = 'a'.repeat(2048);
  const snapshot = () => {
    handle.draw({}, { width: 640, height: 240 });
    return host.recorded.splice(0);
  };
  try {
    await font.load();
    const first = handle.createText({ font, text: 'x' });
    handle.createText({ font, text: prefix });
    const text = handle.createText({ font, text: 'b' });
    glyph.shape();
    const before = snapshot();
    const allocationCount = host.stats.allocations;
    const preparationCount = host.stats.preparations;
    host.uploads.length = 0;
    first.update({ text: 'y' });
    text.update({ text: 'c' });
    glyph.shape();
    const edited = snapshot();
    assert.notDeepEqual(edited, before);
    assert.equal(host.stats.allocations, allocationCount, 'same-capacity edits allocate no GPU buffers');
    assert.equal(host.stats.preparations, preparationCount, 'unchanged draw bindings stay prepared');
    assert.ok(host.uploads.length > 0);
    assert.ok(
      host.uploads.every((upload) => upload.length < upload.capacity / 8),
      JSON.stringify(host.uploads),
    );
    t.diagnostic(
      `Localized edit: ${host.uploads.reduce((sum, upload) => sum + upload.length, 0)} bytes uploaded; zero GPU allocations or draw preparations.`,
    );
    host.uploads.length = 0;
    text.update({ text: 'd' });
    host.stats.reject = true;
    assert.throws(() => glyph.shape(), /Injected renderer rejection/);
    assert.deepEqual(snapshot(), edited);
    assert.equal(host.uploads.length, 0, 'decode/discard must not upload into accepted buffers');
    assert.equal(host.stats.allocations, allocationCount);
    host.stats.reject = false;
    text.update({ text: 'e' });
    glyph.shape();
    const after = snapshot();
    assert.notDeepEqual(after, before);
    assert.equal(host.stats.allocations, allocationCount, 'same-capacity edits allocate no GPU buffers');
    assert.equal(host.stats.preparations, preparationCount, 'unchanged draw bindings stay prepared');
    // A cold publication independently proves the committed patch bytes.
    const cold = handle('cold');
    cold.createText({ font, text: 'y' });
    cold.createText({ font, text: prefix });
    cold.createText({ font, text: 'e' });
    glyph.shape();
    cold.draw({}, { width: 640, height: 240 });
    assert.deepEqual(host.recorded.splice(0), after);
    const retainedAllocations = host.allocations.size;
    host.uploads.length = 0;
    host.stats.reject = true;
    text.update({ text: 'z'.repeat(8192) });
    assert.throws(() => glyph.shape(), /Injected renderer rejection/);
    assert.equal(host.allocations.size, retainedAllocations, 'discard releases resized staging buffers');
    assert.equal(host.uploads.length, 0, 'a discarded resize uploads nothing');
    assert.deepEqual(snapshot(), after);
    host.stats.reject = false;
    text.update({ text: 'e' });
    glyph.shape();
    assert.deepEqual(snapshot(), after);
    host.uploads.length = 0;
    glyph.shape();
    assert.equal(host.uploads.length, 0, 'idle shaping uploads nothing');
  } finally {
    handle.dispose();
    font.dispose();
  }
  assert.equal(host.allocations.size, 0);
});

test('TypeGPU roots consume real engine output, retain idle draws and isolate named roots', async () => {
  const host = recordingHost();
  const handle = glyph.handle('typegpu:test', host.config);
  const font = glyph.fontFace(new Blob([fontBytes]), { format: msdf });
  try {
    await font.load();
    const text = handle.createText({ font, text: 'Hello', style: { fontSize: 48 }, position: [12, 24] });
    const overlay = handle('overlay');
    const label = overlay.createText({ font, text: 'World', position: [100, 80] });
    glyph.shape();
    assert.equal(text.glyphs().glyphIds.length, 5);
    assert.ok(text.measure().width > 0);
    handle.draw({}, { width: 640, height: 240 });
    const first = host.recorded.splice(0);
    assert.ok(first.length > 0);
    assert.equal(
      first.reduce((sum, draw) => sum + draw.count, 0),
      5,
    );
    assert.deepEqual(first[0].position, [12, 24]);
    overlay.draw({}, { width: 640, height: 240 });
    assert.deepEqual(host.recorded[0].position, [100, 80]);
    host.recorded.length = 0;
    glyph.shape();
    handle.draw({}, { width: 640, height: 240 });
    assert.deepEqual(host.recorded.splice(0), first);
    assert.throws(() => text.update({ constraints: { width: { mode: 'at-most', size: NaN } } }), /width/i);
    assert.throws(() => text.update({ position: [NaN, 0] }), /position/);
    handle.draw({}, { width: 640, height: 240 });
    assert.deepEqual(host.recorded.splice(0), first, 'rejected caller input preserves the accepted frame');
    text.update({ text: 'Updated', position: [36, 48] });
    glyph.shape();
    handle.draw({}, { width: 640, height: 240 });
    assert.equal(
      host.recorded.reduce((sum, draw) => sum + draw.count, 0),
      7,
    );
    assert.deepEqual(host.recorded[0].position, [36, 48]);
    host.recorded.length = 0;
    text.dispose();
    glyph.shape();
    handle.draw({}, { width: 640, height: 240 });
    assert.equal(host.recorded.length, 0);
    assert.throws(() => text.measure(), /disposed/);
    label.dispose();
    overlay.dispose();
    handle.dispose();
    assert.equal(host.allocations.size, 0, 'all renderer-owned buffers are released');
    assert.throws(() => handle.draw({}, { width: 640, height: 240 }), /disposed/);
  } finally {
    handle.dispose();
    font.dispose();
  }
});

test('TypeGPU application and shader entrypoints have separate dependency boundaries', async () => {
  const integration = await import('@pmndrs/glyph/typegpu');
  const shaders = await import('@pmndrs/glyph/shaders');
  assert.deepEqual(Object.keys(integration), ['defineTypeGpuConfig']);
  assert.equal(typeof shaders.bitmapFragment, 'function');
  for (const subpath of ['typegpu/bitmap', 'typegpu/internal/renderer', 'typegpu/text']) {
    await assert.rejects(import(`@pmndrs/glyph/${subpath}`), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  }
  const { readJavaScriptModuleClosure } = await import('../support/javascript-module-closure.mjs');
  const closure = await readJavaScriptModuleClosure([new URL('../../dist/typegpu.js', import.meta.url)]);
  assert.equal(
    [...closure.staticImports].some((value) => /^(three|@typegpu\/three|@react-three|react)(\/|$)/.test(value)),
    false,
  );
  const shaderClosure = await readJavaScriptModuleClosure([new URL('../../dist/shaders.js', import.meta.url)]);
  assert.equal(
    shaderClosure.paths.some((value) => /\/(glyph|font|shaper|typegpu\/config)\.js$/.test(value)),
    false,
  );
});
