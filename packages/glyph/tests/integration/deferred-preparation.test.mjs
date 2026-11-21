// Deferred, never-stale preparation through the public Three API: what a setter, a read, an explicit
// prepare and a frame each do, and that all three routes to a prepared layout agree with a cold one.
import { crossingsOf, lastCallArguments, shaperMemoryPages } from '../support/wasm-crossings.mjs';

import assert from 'node:assert/strict';
import test from 'node:test';

import { bitmap, glyph, span, txt } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';
import { createFontCache, timeout } from '../support/text-mutation-lanes.mjs';

const fonts = createFontCache({ inter: { file: 'inter-bitmap-16.font.glb', raster: bitmap({ strikes: [16] }) } });
let nextHandle = 1;

test.after(() => fonts.dispose());

async function createScene(t) {
  const font = await fonts.load('inter');
  const handle = glyph.handle(`three:deferred-preparation:${String(nextHandle++)}`, ThreeConfig);
  t.after(() => handle.dispose());
  const scene = new THREE.Scene();
  const add = (properties) => {
    const text = handle.createText({ font, ...properties });
    scene.add(text);
    return text;
  };
  return { font, handle, scene, add, frame: () => scene.updateMatrixWorld(true) };
}

/** Everything a layout decides, as plain data. */
function layoutOf(text) {
  const glyphs = text.glyphs();
  const measurement = text.measure();
  return {
    width: measurement.width,
    height: measurement.height,
    lineCount: measurement.lineCount,
    glyphCount: measurement.glyphCount,
    glyphIds: [...glyphs.glyphIds],
    x: [...glyphs.x],
    y: [...glyphs.y],
    clusters: [...glyphs.clusters],
  };
}

const paragraph = 'The quick brown fox jumps over the lazy dog. '.repeat(12);
const states = [
  { text: 'first label' },
  { text: paragraph, constraints: { width: { mode: 'exact', size: 240 } } },
  { text: 'styled', style: { fontSize: 24, letterSpacing: 1 } },
  { text: txt`plain ${span({ color: '#ff0000' })`red`} plain` },
  { text: paragraph.slice(0, 200), layout: { align: 'center' }, constraints: { width: { mode: 'exact', size: 120 } } },
];
const edits = [
  { text: 'first label, edited' },
  { constraints: { width: { mode: 'exact', size: 180 } } },
  { style: { fontSize: 18 } },
  { text: txt`plain ${span({ color: '#00ff00', fontSize: 20 })`green`} plain` },
  { text: paragraph.slice(20, 160), layout: { align: 'end' } },
];

test('a batch, a read and a cold build prepare the same layout', { timeout }, async (t) => {
  const cold = await createScene(t);
  const expected = states.map((state, index) => layoutOf(cold.add({ ...state, ...edits[index] })));

  const batched = await createScene(t);
  const batchedTexts = states.map((state) => batched.add(state));
  batched.frame();
  for (const [index, text] of batchedTexts.entries()) text.set(edits[index]);
  assert.deepEqual(crossingsOf(batched.frame), { engine_prepare_batch: 1, engine_update_batch: 1 });
  assert.deepEqual(
    batchedTexts.map(layoutOf),
    expected,
    'the frame prepared every dirty paragraph as a cold build would',
  );
  for (const text of batchedTexts) assert.equal(text.commitState().status, 'committed');

  const read = await createScene(t);
  const readTexts = states.map((state) => read.add(state));
  read.frame();
  for (const [index, text] of readTexts.entries()) {
    text.set(edits[index]);
    assert.deepEqual(layoutOf(text), expected[index], `read ${String(index)} prepared its own paragraph`);
  }
  assert.deepEqual(crossingsOf(read.frame), { engine_update_batch: 1 }, 'the frame prepares nothing a read prepared');
});

test('texts created and removed in one frame are prepared together', { timeout }, async (t) => {
  const { add, frame, scene } = await createScene(t);
  const kept = add({ text: 'kept' });
  const removed = add({ text: 'removed before it was ever prepared' });
  const replaced = add({ text: 'replaced' });
  frame();
  removed.dispose();
  scene.remove(removed);
  replaced.dispose();
  scene.remove(replaced);
  const created = add({ text: 'created in the same frame' });
  kept.text = 'kept, edited';
  assert.deepEqual(crossingsOf(frame), { engine_prepare_batch: 1, engine_update_batch: 1 });
  assert.equal(created.commitState().status, 'committed');
  assert.equal(kept.commitState().status, 'committed');
  assert.equal(created.measure().glyphCount, 'created in the same frame'.replaceAll(' ', '').length + 4);
});

test('a text disposed before any preparation never reaches the engine', { timeout }, async (t) => {
  const { add, frame, scene } = await createScene(t);
  add({ text: 'anchor of the root' });
  frame();
  assert.deepEqual(
    crossingsOf(() => {
      const transient = add({ text: 'never prepared' });
      transient.text = 'still never prepared';
      scene.remove(transient);
      transient.dispose();
      frame();
    }),
    {},
  );
});

test('glyph.prepare() prepares every dirty text in one call and keeps their measurements', { timeout }, async (t) => {
  const { add, frame } = await createScene(t);
  const texts = Array.from({ length: 50 }, (_, index) => add({ text: `label ${String(index)}` }));
  frame();
  for (const [index, text] of texts.entries()) text.text = `value ${String(index)}`;
  assert.deepEqual(
    crossingsOf(() => glyph.prepare()),
    { engine_prepare_batch: 1 },
  );
  assert.deepEqual(
    crossingsOf(() => {
      for (const text of texts) assert.ok(text.measure().width > 0);
    }),
    {},
    'reads after an explicit prepare answer without entering the engine',
  );
  assert.equal(texts[0].commitState().status, 'pending', 'prepare does not publish');
  assert.deepEqual(crossingsOf(frame), { engine_update_batch: 1 });
  assert.equal(texts[0].commitState().status, 'committed');
  assert.deepEqual(
    crossingsOf(() => glyph.prepare()),
    {},
    'nothing is dirty',
  );
});

test('restoring the published value publishes nothing and stays committed', { timeout }, async (t) => {
  const { add, frame } = await createScene(t);
  const text = add({ text: 'published', constraints: { width: { mode: 'exact', size: 200 } } });
  frame();
  const before = layoutOf(text);
  text.text = 'a detour';
  text.text = 'published';
  assert.deepEqual(crossingsOf(frame), {});
  assert.equal(text.commitState().status, 'committed');
  assert.deepEqual(layoutOf(text), before);

  text.text = 'a detour a read observes';
  assert.notDeepEqual(layoutOf(text), before);
  text.text = 'published';
  assert.deepEqual(layoutOf(text), before, 'the read after the restore is current');
  frame();
  assert.equal(text.commitState().status, 'committed');
});

test('one keystroke sends an edit-sized request, in both directions', { timeout }, async (t) => {
  const { add, frame } = await createScene(t);
  const long = 'The quick brown fox jumps over the lazy dog. '.repeat(110);
  const text = add({ text: long, constraints: { width: { mode: 'exact', size: 400 } } });
  frame();
  text.measure();
  const requestLength = () => lastCallArguments('engine_measure_paragraph')[2];
  const middle = long.length >> 1;

  text.text = `${long.slice(0, middle)}x${long.slice(middle)}`;
  text.measure();
  const insertBytes = requestLength();
  text.text = long;
  text.measure();
  const restoreBytes = requestLength();
  assert.ok(
    insertBytes < 512,
    `an insert of one unit sent ${String(insertBytes)} bytes for ${String(long.length)} units`,
  );
  assert.ok(restoreBytes < 512, `a delete of one unit sent ${String(restoreBytes)} bytes`);

  const cold = add({ text: long, constraints: { width: { mode: 'exact', size: 400 } } });
  assert.deepEqual(layoutOf(text), layoutOf(cold), 'an edit and its inverse leave the cold layout');
});

test('an edit next to a surrogate pair never splits it', { timeout }, async (t) => {
  const { add } = await createScene(t);
  const text = add({ text: 'a\u{1F600}b' });
  text.measure();
  for (const next of ['a\u{1F601}b', 'a\u{1F600}\u{1F600}b', 'ab', 'a\u{1F600}b']) {
    text.text = next;
    const cold = add({ text: next });
    assert.deepEqual(layoutOf(text), layoutOf(cold), JSON.stringify(next));
  }
});

test('lone surrogates are drawn as U+FFFD and the text reads back as assigned', { timeout }, async (t) => {
  const { add, frame } = await createScene(t);
  const text = add({ text: 'well formed' });
  const assigned = 'cut \ud83d here and \udc00 there';
  text.text = assigned;
  assert.equal(text.text, assigned, 'the getter returns what the setter was given');
  assert.equal('replacedSurrogates' in text, false, 'the repair has no public surface');
  const reference = add({ text: 'cut \ufffd here and \ufffd there' });
  assert.deepEqual(layoutOf(text), layoutOf(reference));
  text.style = { fontSize: 20 };
  assert.equal(text.text, assigned);
  frame();
  assert.equal(text.commitState().status, 'committed');
  // An edit beside a lone surrogate is derived against the assigned string and still lays out as a cold text.
  text.text = 'cut \ud83d here, and \udc00 there';
  reference.set({ text: 'cut \ufffd here, and \ufffd there', style: { fontSize: 20 } });
  assert.deepEqual(layoutOf(text), layoutOf(reference));
  const created = add({ text: txt`${span({ color: '#ff0000' })`\ud800`} tail` });
  assert.equal(created.text, '\ud800 tail');
  assert.deepEqual(layoutOf(created), layoutOf(add({ text: txt`${span({ color: '#ff0000' })`\ufffd`} tail` })));
});

test('a paint-only change is published without changing the layout', { timeout }, async (t) => {
  const { add, frame } = await createScene(t);
  const text = add({
    text: paragraph,
    style: { color: '#ffffff' },
    constraints: { width: { mode: 'exact', size: 240 } },
  });
  frame();
  const before = layoutOf(text);
  text.style = { color: '#ff0000' };
  assert.deepEqual(crossingsOf(frame), { engine_prepare_batch: 1, engine_update_batch: 1 });
  assert.equal(text.commitState().status, 'committed');
  assert.deepEqual(layoutOf(text), before);
  const cold = add({
    text: paragraph,
    style: { color: '#ff0000' },
    constraints: { width: { mode: 'exact', size: 240 } },
  });
  assert.deepEqual(layoutOf(cold), before);
});

test('an overwritten value is never sent to the engine', { timeout }, async (t) => {
  const { add, frame } = await createScene(t);
  const text = add({ text: 'start' });
  frame();
  text.measure();
  const long = 'x'.repeat(4_000);
  text.text = long;
  text.text = 'final';
  text.measure();
  assert.ok(
    lastCallArguments('engine_measure_paragraph')[2] < 512,
    'the request carries the final value, not the 4,000-unit intermediate',
  );
});

test('the first read of a mount creates every sibling once; later reads carry no lifecycle', { timeout }, async (t) => {
  const { add, frame, scene } = await createScene(t);
  const label = (index) => `label ${String(index).padStart(3, '0')}`;
  const texts = Array.from({ length: 300 }, (_, index) => add({ text: label(index) }));
  const requestLength = () => lastCallArguments('engine_measure_paragraph')[2];
  texts[0].measure();
  const first = requestLength();
  texts[1].measure();
  const second = requestLength();
  texts[299].measure();
  assert.ok(first > second * 4, `the first read (${String(first)} bytes) carries the root's lifecycle`);
  assert.equal(requestLength(), second, 'every later read sends the same paragraph-sized request');

  // A sibling the engine holds but never prepared is still removed from it, and one created later is added.
  const removed = texts[150];
  removed.dispose();
  scene.remove(removed);
  const late = add({ text: label(150) });
  assert.deepEqual(crossingsOf(frame), { engine_prepare_batch: 1, engine_update_batch: 1 });
  assert.equal(late.commitState().status, 'committed');
  assert.equal(texts[200].commitState().status, 'committed');
  const cold = await createScene(t);
  assert.deepEqual(layoutOf(texts[7]), layoutOf(cold.add({ text: label(7) })));
  assert.deepEqual(layoutOf(late), layoutOf(cold.add({ text: label(150) })));
});

test(
  'mounting many labels reserves memory in proportion to the labels, by a read or by a frame',
  { timeout },
  async (t) => {
    const pagesFor = async (count, finish) => {
      const { add, frame } = await createScene(t);
      const before = shaperMemoryPages();
      const texts = Array.from({ length: count }, (_, index) => add({ text: `label ${String(index)}` }));
      finish(texts, frame);
      return shaperMemoryPages() - before;
    };
    const byFrame = await pagesFor(1_500, (_texts, frame) => frame());
    const byRead = await pagesFor(1_500, (texts) => {
      for (const text of texts) text.measure();
    });
    // 64 KiB pages: a label must cost kilobytes, not a share of every other label's geometry.
    assert.ok(byFrame * 65_536 < 1_500 * 48_000, `a frame mount grew memory by ${String(byFrame)} pages`);
    assert.ok(byRead * 65_536 < 1_500 * 48_000, `a read mount grew memory by ${String(byRead)} pages`);
  },
);

test('a batch serializes a summary only for the paragraphs someone will read', { timeout }, async (t) => {
  const { add, frame } = await createScene(t);
  const texts = Array.from({ length: 40 }, (_, index) => add({ text: `label ${String(index)}` }));
  frame();
  const [read, anchored, plain] = texts;
  read.measure();
  anchored.constraints = { anchor: { x: 'center', y: 'middle' } };
  frame();
  for (const [index, text] of texts.entries()) text.text = `value ${String(index)}`;
  assert.deepEqual(crossingsOf(frame), { engine_prepare_batch: 1, engine_update_batch: 1 });
  assert.deepEqual(
    crossingsOf(() => {
      read.measure();
      anchored.measure();
    }),
    {},
    'the text that was read and the anchored text got their summaries from the batch',
  );
  assert.deepEqual(
    crossingsOf(() => plain.measure()),
    { engine_measure_paragraph: 1 },
    'a sibling nobody read was prepared without a summary',
  );
  const cold = await createScene(t);
  assert.deepEqual(layoutOf(plain), layoutOf(cold.add({ text: 'value 2' })));
  assert.equal(anchored.measure().width, cold.add({ text: 'value 1' }).measure().width);
});
