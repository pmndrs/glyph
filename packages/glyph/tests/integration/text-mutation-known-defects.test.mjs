/**
 * Minimal reproductions of three defects found while extending incremental-mutation coverage.
 *
 * Each one is the smallest input that exhibits a defect the differential/packed-lane oracle or the
 * script corpora uncovered, reduced to the public `Text`/`TextGroup` surface and one baked fixture.
 * They are pinned here rather than inside the coverage files so that a red run names the defect
 * instead of naming a corpus, and so that fixing one turns exactly one test green. All three are
 * now fixed, and each pins its fix: reverting the fix turns exactly the case below red again.
 *
 * None of these is the defect fixed by `fix(glyph): rebuild only a slot whose retained identity
 * moved`. That fix holds: the Latin gate and every non-bidi script case pass with it and fail
 * without it.
 *
 *   1. A GLYPH DISAPPEARS FROM THE GPU BUFFER. FIXED.
 *      Deleting a leading left-to-right island, together with its separating space, from a
 *      right-to-left paragraph inside a `TextGroup` left a LATER, UNEDITED paragraph with one
 *      fewer instanced record than it has committed glyphs. The engine still reported every glyph;
 *      the GPU was handed one fewer. Nothing engine-side could see this, which is exactly why the
 *      packed lanes are worth asserting. The retained gather recorded only a selection bit per
 *      source glyph, never the identity that bit belonged to, so a deleted space let an unchanged
 *      glyph read a neighbour's row and skip its own record.
 *
 *   2. A LEGAL TEXT CHANGE MANUFACTURED A PARAGRAPH THE ENGINE REFUSES TO PUBLISH. FIXED.
 *      The engine requires every extended grapheme cluster to resolve to exactly one style. `Text`
 *      did not hold that on its `spans` input: adding a combining scalar at a legal, cluster-
 *      aligned span boundary moved that boundary into the middle of the cluster the change just
 *      created, and the paragraph stopped publishing with an opaque numeric engine status. `Text`
 *      now resolves every span boundary onto the cluster grid before a frame is built (D-265); the
 *      surface around this one case is covered by `text-mutation-span-alignment.test.mjs`. The
 *      original reproduction went through `replaceText`, which has since been removed along with
 *      the rest of the offset-taking edit surface; the case is restated on the `set` that remains.
 *
 *   3. A SPACE FOLLOWED BY A COMBINING MARK WAS REJECTED OUTRIGHT. FIXED.
 *      UAX #14 LB9 does NOT attach a combining mark to a preceding SPACE, so it yields a break
 *      opportunity between them; UAX #29 GB9 attaches it unconditionally, so the two are one
 *      grapheme cluster. The break opportunity therefore falls strictly inside a cluster, and the
 *      engine rejected the whole frame instead of ignoring an opportunity it cannot take. The same
 *      text after any base the two standards agree on -- a letter, a hyphen, a tab, U+00A0 -- is
 *      accepted, which isolates the disagreement as the cause.
 */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';

import { bitmap } from '@pmndrs/glyph/three/bitmap';

import { createFontCache, edit, lanes, mount, timeout, unmount } from '../support/text-mutation-lanes.mjs';
import { findGraphemeBoundaries, findLineBreaks } from '../../dist/internal/unicode.js';

const bitmap16 = { technique: bitmap, options: { strikes: [16] } };
const fonts = createFontCache({
  amiri: { file: 'amiri-bitmap-16.font.glb', raster: bitmap16 },
  inter: { file: 'inter-bitmap-16.font.glb', raster: bitmap16 },
});
after(() => fonts.dispose());

const box = { width: { mode: 'exact', size: 220 }, wrap: 'word' };
const paint = { color: '#ffffff' };

const authored = (text, style, spans = []) => ({ properties: { contentBox: box, paint, spans, style, text } });

/**
 * Committed glyphs against records actually handed to the GPU, per paragraph and in total.
 *
 * Totals alone would catch the loss but not attribute it. A group batches its paragraphs into one
 * draw, so the GPU side cannot name which paragraph lost a record -- the per-paragraph committed
 * counts are the attribution, and they must sum to the records the group actually hands over.
 */
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
  const spans = [{ start: 0, end: 1, paint: { color: '#ff2f00' } }];
  const mounted = mount(font, [authored('abc', latin, spans)]);
  try {
    const node = mounted.nodes[0];
    assert.equal(node.layout().glyphCount, 3, 'the starting paragraph must publish');
    // Legal by the public contract: the caller re-authors the string with a mark inserted and
    // carries forward the range it already had. That fuses 'a' and the mark into one cluster
    // spanning [0, 2), leaving the authored boundary at 1 inside it.
    node.set({ text: 'ábc', spans });
    mounted.scene.updateMatrixWorld(true);
    assert.equal(node.text, 'ábc');
    assert.deepEqual(
      [...findGraphemeBoundaries(node.text)],
      [0, 2, 3, 4],
      'the insertion must fuse the base and the mark into one cluster',
    );
    assert.deepEqual(
      node.spans.map(({ start, end }) => [start, end]),
      [[0, 2]],
      'the boundary must resolve onto the cluster whose base the span already held',
    );
    assert.equal(node.error, undefined, `the paragraph stopped publishing: ${String(node.error?.message)}`);
    assert.equal(node.layout().glyphCount, 3);
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
    assert.equal(mounted.nodes[0].layout().glyphCount, 4);
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
