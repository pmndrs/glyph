// A summary-only `measure()` answers from flow layout and computes its glyph facts (glyph and missing-glyph counts,
// line glyph spans, ink) on first read. These tests hold it to the deferred, never-stale contract: exact before the
// first publication, exact for the text as it was measured after later edits, exact in `onLayout` on the first
// frame, and no growth across many measure and edit cycles.
import { crossingsOf, shaperMemoryPages } from '../support/wasm-crossings.mjs';

import assert from 'node:assert/strict';
import test from 'node:test';

import { bitmap, glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';
import { createFontCache, timeout } from '../support/text-mutation-lanes.mjs';

const fonts = createFontCache({ inter: { file: 'inter-bitmap-16.font.glb', raster: bitmap({ strikes: [16] }) } });
let nextHandle = 1;

test.after(() => fonts.dispose());

async function createScene(t) {
  const font = await fonts.load('inter');
  const handle = glyph.handle(`three:measure-deferred-glyph-facts:${String(nextHandle++)}`, ThreeConfig);
  t.after(() => handle.dispose());
  const scene = new THREE.Scene();
  const add = (properties) => {
    const text = handle.createText({ font, ...properties });
    scene.add(text);
    return text;
  };
  return { add, frame: () => scene.updateMatrixWorld(true) };
}

/** Every field of a summary, glyph facts included, as plain data. */
function summaryOf(measurement) {
  return {
    width: measurement.width,
    height: measurement.height,
    contentWidth: measurement.contentWidth,
    lineCount: measurement.lineCount,
    glyphCount: measurement.glyphCount,
    missingGlyphCount: measurement.missingGlyphCount,
    inkBounds: measurement.inkBounds,
    lines: measurement.lines.map((line) => ({
      textStart: line.textStart,
      textEnd: line.textEnd,
      glyphStart: line.glyphStart,
      glyphCount: line.glyphCount,
      advance: line.advance,
      baseline: line.baseline,
      inkBounds: line.inkBounds,
    })),
  };
}

/** The summary a fresh, published text reports for `properties`. */
async function coldSummary(t, properties) {
  const cold = await createScene(t);
  const text = cold.add(properties);
  cold.frame();
  return summaryOf(text.measure());
}

const paragraph = 'The quick brown fox jumps over the lazy dog. '.repeat(16);
const wide = { text: paragraph, constraints: { width: { mode: 'exact', size: 320 } } };

test('measure() before the first publication is exact, glyph facts included', { timeout }, async (t) => {
  const expected = await coldSummary(t, wide);
  const { add } = await createScene(t);
  const text = add(wide);
  let measurement;
  const crossings = crossingsOf(() => {
    measurement = text.measure();
  });
  assert.equal(crossings.engine_update_batch, undefined, 'a read never publishes');
  assert.equal(measurement.lineCount, expected.lineCount);
  assert.equal(measurement.width, expected.width);
  // The first read of a glyph fact positions the measured preparation, through one read that asks for them.
  const facts = crossingsOf(() => measurement.glyphCount);
  assert.deepEqual(facts, { engine_measure_paragraph: 1 });
  assert.deepEqual(summaryOf(measurement), expected);
  assert.deepEqual(
    crossingsOf(() => summaryOf(measurement)),
    {},
    'resolved facts are plain data',
  );
});

test('a summary answers for the text as it was measured after later edits', { timeout }, async (t) => {
  const edited = { text: `${paragraph}and then some more words`, constraints: { width: { mode: 'exact', size: 260 } } };
  const expectedBefore = await coldSummary(t, wide);
  const expectedAfter = await coldSummary(t, edited);
  const { add, frame } = await createScene(t);
  const text = add({ text: 'mounted', constraints: wide.constraints });
  frame();

  // Measured, then edited and measured again, before any frame.
  text.text = wide.text;
  const first = text.measure();
  text.set(edited);
  const second = text.measure();
  assert.deepEqual(summaryOf(second), expectedAfter);
  assert.deepEqual(summaryOf(first), expectedBefore, 'the earlier summary keeps its own glyph facts');

  // Measured, published by a frame, then edited by a setter the next frame prepares in its batch.
  text.set(wide);
  const third = text.measure();
  frame();
  text.set(edited);
  frame();
  assert.deepEqual(summaryOf(third), expectedBefore);
  assert.deepEqual(summaryOf(text.measure()), expectedAfter);
});

test('onLayout reads exact glyph facts before the first render', { timeout }, async (t) => {
  const expected = await coldSummary(t, wide);
  const { add, frame } = await createScene(t);
  const text = add(wide);
  const seen = [];
  text.onLayout = (_text, layout) => seen.push(summaryOf(layout));
  frame();
  assert.deepEqual(seen, [expected], 'the first frame laid out with exact measurements');
  assert.equal(text.commitState().status, 'committed');
});

test('measure and edit cycles keep no generation alive', { timeout }, async (t) => {
  const { add, frame } = await createScene(t);
  const text = add(wide);
  frame();
  const cycle = (index) => {
    text.constraints = { width: { mode: 'exact', size: 240 + (index % 7) * 16 } };
    text.text = `${paragraph}${String(index)}`;
    // Read every other summary's facts; leave the rest unread across the next edit.
    const measurement = text.measure();
    if (index % 2 === 0) void measurement.glyphCount;
    if (index % 5 === 0) frame();
    return measurement;
  };
  for (let index = 0; index < 40; index += 1) cycle(index);
  const before = shaperMemoryPages();
  const kept = [];
  for (let index = 40; index < 400; index += 1) {
    const measurement = cycle(index);
    if (index % 90 === 1) kept.push([index, measurement]);
  }
  frame();
  assert.equal(shaperMemoryPages(), before, 'engine memory does not grow with measure and edit cycles');
  for (const [index, measurement] of kept) {
    const expected = await coldSummary(t, {
      text: `${paragraph}${String(index)}`,
      constraints: { width: { mode: 'exact', size: 240 + (index % 7) * 16 } },
    });
    assert.deepEqual(summaryOf(measurement), expected, `summary ${String(index)} still answers exactly`);
  }
});
