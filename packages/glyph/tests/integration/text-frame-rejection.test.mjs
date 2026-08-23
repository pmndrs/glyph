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
import * as THREE from 'three/webgpu';
import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { Text, TextFrameError } from '@pmndrs/glyph/three';
import { textShaperAbi } from '@pmndrs/glyph/core';

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

test('a rejected frame names the span that caused it', { timeout }, async () => {
  // Partially overlapping spans are type-legal, in range, and cluster-aligned, so they are the
  // rejection a caller can still reach through the public API. The engine answers it with its own
  // status, and `/three` resolves the paragraph handle and style id in the header back onto the
  // objects the caller wrote.
  await withParagraph('abcdefgh', [styled(0, 4), styled(2, 6)], (node, mounted) => {
    mounted.scene.updateMatrixWorld(true);
    const error = node.error;
    assert.ok(error instanceof TextFrameError, `expected a TextFrameError, received ${String(error)}`);
    assert.equal(error.rejection.cause, 'span-overlap');
    assert.equal(error.status, textShaperAbi.status.styleNestingInvalid);
    assert.equal(error.rejection.subject.kind, 'span');
    assert.equal(error.rejection.subject.text, node, 'the subject must be the Text the caller holds');
    assert.equal(error.rejection.subject.index, 1, 'the second span is the one that escapes the first');
    assert.equal(error.rejection.subject.span, node.spans[1]);
    assert.match(error.message, /spans\[1\] \(2, 6\)/);
  });
});

test('a rejection latches until its input moves', { timeout }, async () => {
  // The loop this closes: a rejected frame never reaches `markApplied()`, so `needsApply()` stays
  // true and the identical frame is recompiled and rejected on every frame forever. The latch is
  // keyed on the desired revision of every paragraph in render order, so only a real `set()` --
  // not another frame, and not an unrelated repaint of the scene -- releases it.
  await withParagraph('abcdefgh', [styled(0, 4)], (node, mounted) => {
    // The batch is owned by the TextGroup that `mount` builds, so the group is where a rejection is
    // reported; `Text.error` reads through to it.
    const reports = [];
    mounted.group.onError = (error) => reports.push(error);
    assert.equal(node.error, undefined, 'the paragraph must start from an accepted frame');

    node.set({ spans: [styled(0, 4), styled(2, 6)] });
    mounted.scene.updateMatrixWorld(true);
    assert.equal(reports.length, 1, 'the rejection must be reported once');
    const first = node.error;
    assert.ok(first instanceof TextFrameError);

    for (let frame = 0; frame < 8; frame += 1) mounted.scene.updateMatrixWorld(true);
    assert.equal(reports.length, 1, 'an unchanged frame must not be recompiled or re-reported');
    assert.equal(node.error, first, 'the latched rejection must remain the observable state');

    // A caller-invoked query must not read `undefined` off a latched batch as if the paragraph
    // merely had no layout yet. It raises what the query raised before the latch existed.
    assert.throws(() => node.measureLayout(), TextFrameError);
    assert.throws(() => node.inspectLayout(), TextFrameError);

    // An update that does not fix the overlap re-compiles once and latches again on the new input.
    node.set({ paint: { color: '#00ff2f' } });
    mounted.scene.updateMatrixWorld(true);
    assert.equal(reports.length, 2, 'a changed input must be compiled again');
    for (let frame = 0; frame < 4; frame += 1) mounted.scene.updateMatrixWorld(true);
    assert.equal(reports.length, 2, 'and must latch again on the input it was rejected for');

    // Correcting the input clears the latch and the error together.
    node.set({ spans: [styled(0, 4)] });
    mounted.scene.updateMatrixWorld(true);
    assert.equal(reports.length, 2, 'an accepted frame reports nothing');
    assert.equal(node.error, undefined, `the paragraph never recovered: ${String(node.error?.message)}`);
  });
});

test('a standalone Text latches on its own binding', { timeout }, async () => {
  // A Text with no TextGroup owns its own batch and its own `#error`, on a separate branch of
  // `updateMatrixWorld`. The latch has to hold there too, or the loop simply moves.
  const font = await fonts.load('inter');
  const scene = new THREE.Scene();
  const node = new Text({ font, contentBox: box, paint, style: latin, text: 'abcdefgh' });
  scene.add(node);
  const reports = [];
  node.onError = (error) => reports.push(error);
  try {
    scene.updateMatrixWorld(true);
    assert.equal(node.error, undefined, 'the paragraph must start from an accepted frame');

    node.set({ spans: [styled(0, 4), styled(2, 6)] });
    scene.updateMatrixWorld(true);
    const first = node.error;
    assert.ok(first instanceof TextFrameError, `expected a TextFrameError, received ${String(first)}`);
    assert.equal(reports.length, 1);

    for (let frame = 0; frame < 8; frame += 1) scene.updateMatrixWorld(true);
    assert.equal(reports.length, 1, 'an unchanged frame must not be recompiled or re-reported');
    assert.equal(node.error, first, 'the latched rejection must remain the observable state');

    node.set({ spans: [] });
    scene.updateMatrixWorld(true);
    assert.equal(node.error, undefined, `the paragraph never recovered: ${String(node.error?.message)}`);
  } finally {
    node.dispose();
  }
});
