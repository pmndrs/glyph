import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { glyph } from '@pmndrs/glyph';
import { defineTypeGpuConfig } from '@pmndrs/glyph/typegpu';
import { resourceLease } from '@pmndrs/glyph/config/glyph';
import { msdf, msdfSchema } from '@pmndrs/glyph/raster/msdf';
import { TYPEGPU_PLACEMENT_SLOT_BUFFER_ID } from '../../dist/typegpu/internal/codec.js';

const fontBytes = await readFile(
  new URL('../../../../apps/r3f-hello-world/assets/inter-latin.font.glb', import.meta.url),
);
globalThis.GPUBufferUsage ??= { VERTEX: 32, COPY_DST: 8, STORAGE: 128 };
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
          prepare(buffers, placementTable, viewport, position, start, count) {
            stats.preparations++;
            return {
              draw() {
                const placementSlots = buffers
                  .get(TYPEGPU_PLACEMENT_SLOT_BUFFER_ID)
                  .bytes.slice(start * 4, (start + count) * 4);
                const placementTableBytes = placementTable.bytes.slice();
                const slotView = new DataView(
                  placementSlots.buffer,
                  placementSlots.byteOffset,
                  placementSlots.byteLength,
                );
                const tableView = new DataView(
                  placementTableBytes.buffer,
                  placementTableBytes.byteOffset,
                  placementTableBytes.byteLength,
                );
                recorded.push({
                  // Compare raster inputs, not lifecycle-specific stable glyph identities.
                  buffers: Object.values(msdfSchema.buffers).map((declaration) => {
                    const stride = declaration.lanes.length * 4;
                    return buffers.get(declaration.id).bytes.slice(start * stride, (start + count) * stride);
                  }),
                  placementSlots,
                  placementTable: placementTableBytes,
                  resolvedPlacement: Array.from({ length: count }, (_, index) => {
                    const slot = slotView.getUint32(index * 4, true);
                    return [tableView.getFloat32(slot * 8, true), tableView.getFloat32(slot * 8 + 4, true)];
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
    root: {
      create(context) {
        const selected = base.root.create(context);
        selected.createCoreText = (selection, options) => {
          const font = context.fonts.acquire(selection);
          const transform = { position: root.createUniform() };
          let state = { ...options, font, transform };
          let controller;
          let disposed = false;
          try {
            controller = context.services.createText(state);
          } catch (error) {
            transform.position.buffer.destroy();
            font.dispose();
            throw error;
          }
          return {
            update(update) {
              if (disposed) throw new Error('core test text is disposed');
              const next = { ...state, ...update, font, transform };
              controller.update(next);
              state = next;
            },
            dispose() {
              if (disposed) return;
              disposed = true;
              try {
                controller.dispose();
              } finally {
                transform.position.buffer.destroy();
                font.dispose();
              }
            },
          };
        };
        return selected;
      },
    },
  };
  return { config, allocations, recorded, uploads, stats };
}

function renderedState(draws) {
  return draws.map(({ placementSlots: _slots, placementTable: _table, resolvedPlacement, ...draw }) => {
    const buffers = draw.buffers.map((buffer) => buffer.slice());
    const rects = new Float32Array(buffers[0].buffer, buffers[0].byteOffset, buffers[0].byteLength / 4);
    for (let index = 0; index < resolvedPlacement.length; index++) {
      rects[index * 4] = Math.fround(rects[index * 4] + resolvedPlacement[index][0]);
      rects[index * 4 + 1] = Math.fround(rects[index * 4 + 1] + resolvedPlacement[index][1]);
    }
    return { ...draw, buffers };
  });
}

test('TypeGPU width reflow retains raster bytes and changes only host placement', async () => {
  const host = recordingHost();
  const handle = glyph.handle('typegpu:direct-placement', host.config);
  const font = glyph.fontFace(new Blob([fontBytes]), { format: msdf });
  try {
    await font.load();
    const text = handle.createText({
      font,
      text: 'alpha beta gamma delta epsilon zeta eta theta',
      constraints: { width: { mode: 'exact', size: 300 } },
    });
    glyph.shape();
    handle.draw({}, { width: 640, height: 240 });
    const before = host.recorded.splice(0);
    const allocationCount = host.stats.allocations;
    const preparationCount = host.stats.preparations;

    text.update({ constraints: { width: { mode: 'exact', size: 90 } } });
    glyph.shape();
    handle.draw({}, { width: 640, height: 240 });
    const after = host.recorded.splice(0);

    assert.equal(after.length, before.length, 'width reflow preserves draw topology');
    assert.deepEqual(
      after.map((draw) => draw.buffers),
      before.map((draw) => draw.buffers),
      'width reflow preserves every raster Codec buffer',
    );
    assert.deepEqual(
      after.map((draw) => draw.placementSlots),
      before.map((draw) => draw.placementSlots),
      'width reflow retains each glyph-to-segment assignment',
    );
    assert.notDeepEqual(
      after.map((draw) => draw.placementTable),
      before.map((draw) => draw.placementTable),
      'width reflow updates only the root-owned x/y segment table',
    );
    assert.equal(host.stats.allocations, allocationCount, 'same-capacity reflow allocates no GPU buffers');
    assert.equal(host.stats.preparations, preparationCount, 'same-buffer reflow retains prepared draws');
    text.dispose();
  } finally {
    handle.dispose();
    font.dispose();
  }
  assert.equal(host.allocations.size, 0);
});

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
      host.uploads.every((upload) => upload.length <= upload.capacity / 8),
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
    assert.deepEqual(renderedState(host.recorded.splice(0)), renderedState(after));
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
    assert.deepEqual(renderedState(snapshot()), renderedState(after));
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

test('TypeGPU text snapshots nested desired state before comparing later updates', async () => {
  const host = recordingHost();
  const handle = glyph.handle('typegpu:nested-state-snapshot', host.config);
  const font = glyph.fontFace(new Blob([fontBytes]), { format: msdf });
  try {
    await font.load();
    const width = { mode: 'exact', size: 200 };
    const text = handle.createText({
      font,
      text: 'A deliberately long line that must wrap after its exact width changes.',
      constraints: { width },
      layout: { wrap: 'word' },
    });
    glyph.shape();
    const before = text.measure();
    assert.equal(before.width, 200);

    const originalStructuredClone = globalThis.structuredClone;
    let structuredCloneCalls = 0;
    globalThis.structuredClone = (...arguments_) => {
      structuredCloneCalls += 1;
      return originalStructuredClone(...arguments_);
    };
    try {
      width.size = 40;
      text.update({ constraints: { width } });
    } finally {
      globalThis.structuredClone = originalStructuredClone;
    }
    const after = text.measure();
    assert.equal(after.width, 40);
    assert.ok(after.lineCount > before.lineCount);
    assert.equal(structuredCloneCalls, 1, 'one owning boundary snapshots an actual property change');

    const OriginalWeakMap = globalThis.WeakMap;
    globalThis.WeakMap = class extends OriginalWeakMap {
      constructor() {
        super();
        throw new Error('unchanged properties must not allocate comparison state');
      }
    };
    try {
      text.update({ text: 'A different line reuses the retained property snapshots.' });
    } finally {
      globalThis.WeakMap = OriginalWeakMap;
    }

    text.dispose();
  } finally {
    handle.dispose();
    font.dispose();
  }
});

test('the shared planner rejects duplicate final orders while allowing atomic swaps', async () => {
  const host = recordingHost();
  const handle = glyph.handle('typegpu:order-preflight', host.config);
  const font = glyph.fontFace(new Blob([fontBytes]), { format: msdf });
  let first;
  let second;
  try {
    await font.load();
    first = handle.createCoreText(font, { text: 'first', order: 0 });
    second = handle.createCoreText(font, { text: 'second', order: 1 });
    glyph.shape();

    first.update({ order: 1 });
    second.update({ order: 0 });
    assert.doesNotThrow(() => glyph.shape(), 'the final desired order permits an atomic swap');

    second.update({ order: 1 });
    assert.throws(() => glyph.shape(), /retained text order 1 is already in use/);
    second.update({ order: 0 });
    assert.doesNotThrow(() => glyph.shape(), 'a rejected duplicate leaves the desired frame repairable');
  } finally {
    first?.dispose();
    second?.dispose();
    handle.dispose();
    font.dispose();
  }
});

test('TypeGPU application and shader entrypoints have separate dependency boundaries', async () => {
  const integration = await import('@pmndrs/glyph/typegpu');
  const shaders = await import('@pmndrs/glyph/shaders/typegpu');
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
  const shaderClosure = await readJavaScriptModuleClosure([
    new URL('../../dist/shaders/typegpu/index.js', import.meta.url),
  ]);
  assert.equal(
    shaderClosure.paths.some((value) => /\/(glyph|font|shaper|typegpu\/config)\.js$/.test(value)),
    false,
  );
});
