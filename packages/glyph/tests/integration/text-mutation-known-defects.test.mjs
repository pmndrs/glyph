/** Minimal regression pins for three fixed defects the packed-lane oracle and script corpora found; each test is the smallest repro, and reverting its fix turns exactly that test red. */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';

import { span, txt } from '@pmndrs/glyph';
import { bitmap } from '@pmndrs/glyph/raster/bitmap';

import { createFontCache, edit, lanes, mount, timeout, unmount } from '../support/text-mutation-lanes.mjs';
import { findLineBreaks } from '../support/unicode-line-breaks.mjs';
import { findGraphemeBoundaries } from '../../dist/internal/graphemes.js';

const bitmap16 = bitmap({ strikes: [16] });
const fonts = createFontCache({
  amiri: { file: 'amiri-bitmap-16.font.glb', raster: bitmap16 },
  inter: { file: 'inter-bitmap-16.font.glb', raster: bitmap16 },
});
after(() => fonts.dispose());

const constraints = { width: { mode: 'exact', size: 220 } };
const layout = { wrap: 'word' };
const paint = { color: '#ffffff' };

const authored = (text, style, spans = []) => ({
  properties: { constraints, layout, spans, style: [style, paint], text },
});

/** Committed glyphs vs. GPU-handed records, per paragraph and in total. Per-paragraph counts attribute a loss that a batched single-draw total cannot pin to one paragraph. */
function drawn(mounted) {
  const scene = lanes(mounted);
  const glyphs = scene.paragraphs.map((entry) => entry.glyphCount);
  // Draws are ordered by run start, and each paragraph owns one contiguous run here.
  const instances = [...scene.draws].sort((left, right) => left.start - right.start).map((draw) => draw.instances);
  return {
    byParagraph: glyphs,
    byDraw: instances,
    glyphs: glyphs.reduce((total, count) => total + count, 0),
    instances: instances.reduce((total, count) => total + count, 0),
  };
}

test('1. an unedited paragraph keeps every record when a bidi island is deleted above it', { timeout }, async () => {
  const font = await fonts.load('amiri');
  const arabic = { fontSize: 6, lineHeight: 1, direction: 'rtl', language: 'ar' };
  // Neither final text contains a space, so every committed glyph must occupy an instanced record.
  // The second paragraph is never touched.
  const settled = [authored('النص', arabic), authored('العربي', arabic)];
  const mounted = mount(font, [authored('PMNDRS النص', arabic), authored('العربي', arabic)]);
  let fresh;
  try {
    edit(mounted, font, settled);
    // The comparison group is built AFTER the edit on purpose. Building a second group BEFORE the
    // edit masks the defect -- the edited group then hands over all ten records -- so the order
    // here is load-bearing, not incidental.
    fresh = mount(font, settled);
    assert.deepEqual(drawn(mounted), drawn(fresh), 'an edited group must hand the GPU what a fresh one does');
    // The unedited second paragraph owns 6 of the 10 glyphs. Pinning the split is what separates
    // this defect from a loss in the edited paragraph, which would leave the totals identical.
    assert.deepEqual(
      drawn(mounted),
      { byParagraph: [4, 6], byDraw: [10], glyphs: 10, instances: 10 },
      'every committed glyph must occupy a record, in the paragraph that committed it',
    );
  } finally {
    unmount(mounted);
    if (fresh !== undefined) unmount(fresh);
  }
});

test('2. an authored span kept across a text change stays aligned to clusters', { timeout }, async () => {
  const font = await fonts.load('inter');
  const latin = { fontSize: 6, lineHeight: 1 };
  // 'abc' is three single-scalar clusters, so a span over the first is cluster-aligned and legal.
  const red = span({ color: '#ff2f00' });
  const mounted = mount(font, [authored(txt`${red`a`}bc`, latin)]);
  try {
    const node = mounted.nodes[0];
    assert.equal(node.measure().glyphCount, 3, 'the starting paragraph must publish');
    // Legal by the public contract: the caller structurally re-authors the same styled fragment
    // followed by a combining mark. Concatenation fuses them into one cluster spanning [0, 2),
    // so txt must move the derived boundary instead of exposing or retaining a raw offset.
    const updated = txt`${red`a`}́bc`;
    node.set({ text: updated });
    mounted.scene.updateMatrixWorld(true);
    assert.equal(node.text, 'ábc');
    assert.deepEqual(
      [...findGraphemeBoundaries(node.text)],
      [0, 2, 3, 4],
      'the insertion must fuse the base and the mark into one cluster',
    );
    assert.deepEqual(
      updated.spans.map(({ start, end }) => [start, end]),
      [[0, 2]],
      'the boundary must resolve onto the cluster whose base the span already held',
    );
    assert.equal(node.error, undefined, `the paragraph stopped publishing: ${String(node.error?.message)}`);
    assert.equal(node.measure().glyphCount, 3);
  } finally {
    unmount(mounted);
  }
});

test('3. a break opportunity inside a grapheme cluster is ignored, not rejected', { timeout }, async () => {
  const font = await fonts.load('inter');
  const latin = { fontSize: 6, lineHeight: 1 };
  const text = 'x ́y';
  const clusters = [...findGraphemeBoundaries(text)];
  const breaks = findLineBreaks(text).map((entry) => entry.position);
  // The precondition this case rests on: the two standards genuinely disagree here.
  assert.deepEqual(clusters, [0, 1, 3, 4], 'the space and the mark must form one grapheme cluster');
  assert.ok(
    breaks.some((position) => position > 0 && position < text.length && !clusters.includes(position)),
    'UAX #14 must offer a break strictly inside that cluster for this case to mean anything',
  );

  const mounted = mount(font, [authored(text, latin)]);
  try {
    assert.equal(mounted.nodes[0].error, undefined, `the paragraph was rejected: ${String(mounted.nodes[0].error)}`);
    assert.equal(mounted.nodes[0].measure().glyphCount, 4);
  } finally {
    unmount(mounted);
  }
});

test('3b. the same mark after a base the two standards agree on is accepted', { timeout }, async () => {
  // The negative control for case 3. These pass today; they are here so that a fix for case 3
  // cannot be a blanket relaxation that stops distinguishing the disagreement from ordinary text.
  const font = await fonts.load('inter');
  const latin = { fontSize: 6, lineHeight: 1 };
  for (const base of ['a', '-', '\t', ' ']) {
    const text = `x${base}́y`;
    const clusters = [...findGraphemeBoundaries(text)];
    const interior = findLineBreaks(text)
      .map((entry) => entry.position)
      .filter((position) => position > 0 && position < text.length && !clusters.includes(position));
    assert.deepEqual(interior, [], `${JSON.stringify(base)}: this control needs the standards to agree`);
    const mounted = mount(font, [authored(text, latin)]);
    try {
      assert.equal(mounted.nodes[0].error, undefined, `${JSON.stringify(base)}: ${String(mounted.nodes[0].error)}`);
    } finally {
      unmount(mounted);
    }
  }
});
