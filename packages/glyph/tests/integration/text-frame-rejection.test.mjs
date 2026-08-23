/**
 * What a caller sees when a frame is refused.
 *
 * Three defects had one shape: the caller was told nothing useful, and told it forever.
 *
 *   1. Every frame rejection arrived as `EngineError::InvalidRequest` -> `status 6`, one integer
 *      standing for more than twenty causes, from a span that splits a grapheme cluster to an
 *      arithmetic overflow inside an arena. It named no paragraph, no span, and no offset, and
 *      `textShaperAbi.status` was not even reachable from `/three` to turn it back into a word.
 *   2. A rejected frame never reaches `markApplied()`, so `needsApply()` stayed true and the
 *      IDENTICAL frame was recompiled and rejected on every `updateMatrixWorld` for the life of
 *      the scene, with the last good publication left on screen.
 *   3. `spans` carried four invariants enforced at three different times by three different
 *      policies, so an inverted range -- pure caller arithmetic, unrepairable -- travelled all the
 *      way to Rust before failing, with a stack that named the render loop rather than the caller.
 *
 * This file pins the contract that replaced them: caller-actionable causes are separated from
 * internal invariant violations and carry the paragraph and style they name (D-267), a rejection
 * latches until its input actually moves (D-269), and a range a caller cannot have meant throws
 * from `set()` (D-268).
 */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';

import '../support/browser-globals.mjs';
import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { Text } from '@pmndrs/glyph/three';

import { createFontCache, mount, timeout, unmount } from '../support/text-mutation-lanes.mjs';

const bitmap16 = { technique: bitmap, options: { strikes: [16] } };
const fonts = createFontCache({ inter: { file: 'inter-bitmap-16.font.glb', raster: bitmap16 } });
after(() => fonts.dispose());

const box = { width: { mode: 'exact', size: 220 }, wrap: 'word' };
const paint = { color: '#ffffff' };
const latin = { fontSize: 6, lineHeight: 1 };
const styled = (start, end) => ({ start, end, paint: { color: '#ff2f00' } });
const authored = (text, spans = []) => ({ properties: { contentBox: box, paint, spans, style: latin, text } });

/** Mount one paragraph, run the body against its node, and always tear the scene down. */
async function withParagraph(text, spans, body) {
  const font = await fonts.load('inter');
  const mounted = mount(font, [authored(text, spans)]);
  try {
    await body(mounted.nodes[0], mounted);
  } finally {
    unmount(mounted);
  }
}

test('a range no caller can have meant throws where the caller wrote it', { timeout }, async () => {
  // `normalizedColumns` and `normalizeCapacity` already throw from this same function. An inverted
  // or out-of-range span belongs with them: nothing downstream can repair it, so deferring it to a
  // frame only moves the report away from the code that produced the number.
  const font = await fonts.load('inter');
  const mounted = mount(font, [authored('abcdef', [styled(0, 3)])]);
  const node = mounted.nodes[0];
  try {
    assert.throws(() => node.set({ spans: [styled(4, 2)] }), /span 0 is inverted: start 4 is after end 2/);
    assert.throws(() => node.set({ spans: [styled(0, 99)] }), /span 0 covers \[0, 99\) outside text of length 6/);
    assert.throws(() => node.set({ spans: [styled(-1, 3)] }), /span 0 covers \[-1, 3\) outside text of length 6/);
    assert.throws(() => node.set({ spans: [styled(0, 1.5)] }), /span 0 offsets must be integers/);
    assert.throws(() => node.set({ spans: [styled(0, Number.NaN)] }), /span 0 offsets must be integers/);
    // The rejected update changed nothing: `set()` normalizes before it commits any state, so a
    // throw leaves the paragraph exactly as it was and the scene keeps publishing.
    assert.deepEqual(
      node.spans.map((span) => [span.start, span.end]),
      [[0, 3]],
      'a rejected update must not partially apply',
    );
    mounted.scene.updateMatrixWorld(true);
    assert.equal(node.error, undefined, `the paragraph stopped publishing: ${String(node.error?.message)}`);
    // Out-of-range is measured against the text the update states, not the text it replaces.
    node.set({ text: 'ab', spans: [styled(0, 2)] });
    assert.throws(() => node.set({ spans: [styled(0, 6)] }), /outside text of length 2/);
  } finally {
    unmount(mounted);
  }
});

test('a collapsed span is kept and a cluster boundary still resolves in silence', { timeout }, async () => {
  // The two invariants `set()` does NOT throw for, asserted here so the new validation cannot grow
  // to cover them. A collapsed span states nothing but still occupies its index, and a boundary
  // inside a cluster has a correct answer -- the cluster takes the style of its base.
  await withParagraph('ábc', [styled(0, 1), styled(2, 2)], (node, mounted) => {
    assert.deepEqual(
      node.spans.map((span) => [span.start, span.end]),
      [
        [0, 2],
        [2, 2],
      ],
      'the boundary must resolve forward and the collapsed span must survive at its index',
    );
    mounted.scene.updateMatrixWorld(true);
    assert.equal(node.error, undefined, `the paragraph stopped publishing: ${String(node.error?.message)}`);
  });
});

test('a partial overlap throws where the caller wrote it', { timeout }, async () => {
  // This was the last rejection a caller could reach through the public API: partially overlapping
  // spans are type-legal, in range, and cluster-aligned, so they compiled and the engine refused
  // the whole frame with a status. A style scope is a stack, so the engine has no resolution for
  // them -- but the caller does not learn that from a frame status, and the paragraph they wrote
  // is what needs naming. Both spans and both indices are named here, with the caller on the stack.
  const font = await fonts.load('inter');
  assert.throws(
    () =>
      new Text({ font, contentBox: box, paint, style: latin, text: 'abcdefgh', spans: [styled(0, 4), styled(2, 6)] }),
    (error) =>
      error instanceof RangeError &&
      /span 1 \[2, 6\) partially overlaps span 0/.test(error.message) &&
      /must nest or be disjoint/.test(error.message),
  );
});

test('an unpaired surrogate throws where the caller wrote it', { timeout }, async () => {
  // A lone surrogate is not a character and shaping refuses the frame carrying one. It used to be
  // handed to the engine deliberately; the offset is what a caller can act on.
  const font = await fonts.load('inter');
  assert.throws(
    () => new Text({ font, contentBox: box, paint, style: latin, text: 'ab\ud800cd' }),
    (error) => error instanceof RangeError && /text offset 2 is an unpaired high surrogate/.test(error.message),
  );
});

test('a malformed feature range throws naming the span and the feature', { timeout }, async () => {
  // Only the outer span range was validated, so a feature range inside it reached the engine and
  // was refused there, naming neither.
  const font = await fonts.load('inter');
  assert.throws(
    () =>
      new Text({
        font,
        contentBox: box,
        paint,
        style: latin,
        text: 'abcdefgh',
        spans: [{ start: 0, end: 4, style: { features: [{ tag: 'liga', value: 1, start: 3, end: 1 }] } }],
      }),
    (error) => error instanceof RangeError && /span 0 feature 0 \(liga\) is inverted/.test(error.message),
  );
});

// The two latch tests that stood here drove the latch through that same overlap, which is the only
// way a caller could ever produce a frame rejection. With the boundary closed there is no public
// path to one, so the latch can no longer be exercised from a `Text` at all -- which is the whole
// point of closing it. The latch is retained as containment for a defect in this package: it stops
// an invalid frame recompiling and failing silently at frame rate behind the last good picture.
// Its remaining coverage is the Rust-side tests that produce each status directly.
