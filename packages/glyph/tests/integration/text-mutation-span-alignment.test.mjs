/**
 * One style per extended grapheme cluster, held at the `Text` boundary.
 *
 * The shaper resolves exactly one style per cluster and rejects any frame whose styles split one
 * (`cluster_state.rs`, `build`). Reaching that rejection costs a full publish and returns a numeric
 * engine status naming no span, so `Text` resolves every span boundary onto the cluster grid before
 * a frame is built, under one rule stated constructively rather than as a rejection:
 *
 *   A CLUSTER TAKES THE STYLE OF ITS BASE. Every boundary moves forward to the end of the cluster
 *   containing it, so the marks that attach to a base follow the base's style. The same rule applies
 *   to spans a caller authored and to spans the edit helpers rebased, because through the React
 *   surface those are the same act: a declarative caller re-authoring `text` and `spans` after an
 *   edit passes exactly what `replaceText` would have derived.
 *
 * A span that loses every cluster it covered collapses to an empty range and is KEPT, so that
 * `Text.spans` still reports it, `setSpan`/`removeSpan` keep addressing the same span by index, and
 * no style disappears without a trace in the array. An empty span states nothing and is not
 * compiled into an engine style.
 *
 * `text-mutation-known-defects.test.mjs` case 2 pins the one-character reproduction. This file
 * covers the surface around it, and closes with a seeded sequence asserting the property the whole
 * design exists for: no sequence of legal public calls can leave a paragraph the engine refuses.
 *
 * Cluster boundaries are read through the package's own `findGraphemeBoundaries` rather than
 * `Intl.Segmenter`, whose Unicode version follows the host ICU and can place a boundary this
 * package's tables do not. The Rust `unicode-segmentation` the shaper uses and this JavaScript
 * segmenter are two implementations of one specification pinned to one Unicode version, so the
 * corpus below asserts they agree before it asserts anything about spans.
 */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createElement } from 'react';

import '../support/browser-globals.mjs';
import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { alignSpansToClusters } from '@pmndrs/glyph/three';
import { Text as R3fText } from '@pmndrs/glyph/react';

import { createFontCache, mount, seededRandom, timeout, unmount } from '../support/text-mutation-lanes.mjs';
import { findGraphemeBoundaries } from '../../dist/internal/unicode.js';

// The r3f test renderer constructs a WebGPU renderer whose animation loop needs a host context node
// does not provide. Nothing here drives a frame; these stubs only let the renderer construct.
globalThis.self ??= globalThis;
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => undefined;
// r3f then mounts, commits, and disposes synchronously, so the assertions below observe the settled
// tree rather than whatever a scheduled flush happened to have reached.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const bitmap16 = { technique: bitmap, options: { strikes: [16] } };
const fonts = createFontCache({ inter: { file: 'inter-bitmap-16.font.glb', raster: bitmap16 } });
after(() => fonts.dispose());

const ACUTE = '́';
/** One astral scalar, so a span boundary can fall between the two halves of a surrogate pair. */
const ASTRAL = '\u{1d400}';
/** Two regional indicators, one flag, one cluster of four code units. */
const FLAG = '\u{1f1ef}\u{1f1f5}';
/** A ZWJ emoji sequence: one cluster of eight code units across three emoji and two joiners. */
const FAMILY = '\u{1f468}‍\u{1f469}‍\u{1f467}';
/** Devanagari KA + VIRAMA + SSA: one conjunct cluster. */
const CONJUNCT = 'क्ष';
/** Hangul L + V + T jamo: one syllable cluster under GB6-GB8. */
const JAMO = '각';

const box = { width: { mode: 'exact', size: 220 }, wrap: 'word' };
const paint = { color: '#ffffff' };
const latin = { fontSize: 6, lineHeight: 1 };

const styled = (start, end) => ({ start, end, paint: { color: '#ff2f00' } });
const authored = (text, spans = []) => ({ properties: { contentBox: box, paint, spans, style: latin, text } });

const offsets = (node) => node.spans.map((span) => [span.start, span.end]);
const clusters = (text) => [...findGraphemeBoundaries(text)];

/** Every span boundary is a cluster boundary. */
function assertAligned(node, context) {
  const boundaries = new Set(findGraphemeBoundaries(node.text));
  for (const [index, span] of node.spans.entries()) {
    assert.ok(span.start <= span.end, `${context}: span ${index} inverted to [${span.start}, ${span.end})`);
    assert.ok(boundaries.has(span.start), `${context}: span ${index} starts at ${span.start}, inside a cluster`);
    assert.ok(boundaries.has(span.end), `${context}: span ${index} ends at ${span.end}, inside a cluster`);
  }
}

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

/**
 * The multi-scalar clusters this file relies on, asserted to BE single clusters first.
 *
 * Every span case below is meaningless unless the segmenter really fuses these, and a Unicode
 * version bump that split one of them would otherwise turn into a confusing span failure rather
 * than the segmentation change it is.
 */
const MULTI_SCALAR_CLUSTERS = [
  { label: 'combining acute', text: `a${ACUTE}`, units: 2 },
  { label: 'astral scalar', text: ASTRAL, units: 2 },
  { label: 'regional indicator pair', text: FLAG, units: 4 },
  { label: 'ZWJ emoji sequence', text: FAMILY, units: 8 },
  { label: 'Devanagari conjunct', text: CONJUNCT, units: 3 },
  { label: 'Hangul jamo syllable', text: JAMO, units: 3 },
];

test('the corpus below really is one cluster per entry', () => {
  for (const { label, text, units } of MULTI_SCALAR_CLUSTERS) {
    assert.equal(text.length, units, `${label}: fixture length changed`);
    assert.deepEqual(clusters(text), [0, units], `${label}: must segment as exactly one cluster`);
  }
});

test('alignSpansToClusters returns its argument by identity when nothing moves', () => {
  const spans = [styled(0, 1), styled(1, 3)];
  assert.equal(alignSpansToClusters('abc', spans), spans, 'an aligned list must not be rebuilt');
  const split = [styled(0, 1)];
  const resolved = alignSpansToClusters(`a${ACUTE}bc`, split);
  assert.notEqual(resolved, split, 'a moved boundary must be observable by identity');
  assert.deepEqual(
    resolved.map((span) => [span.start, span.end]),
    [[0, 2]],
  );
  assert.equal(resolved[0].paint, split[0].paint, 'resolution must carry every other property through');
});

test('an out-of-range boundary is left alone rather than clamped into a plausible style', () => {
  const spans = [styled(0, 9)];
  assert.equal(alignSpansToClusters('abc', spans), spans, 'range validity is not this rule to enforce');
});

test('ill-formed text has no cluster grid, so its spans are returned untouched', () => {
  const spans = [styled(0, 1)];
  assert.equal(alignSpansToClusters('\ud800', spans), spans);
});

/**
 * One authored span per multi-scalar cluster, ending one code unit inside it.
 *
 * Each is exactly the shape that reached the engine as an unattributed status before this rule
 * existed, and each must now publish with the cluster wholly inside the span.
 */
for (const { label, text: cluster, units } of MULTI_SCALAR_CLUSTERS) {
  test(`an authored span that splits a ${label} resolves onto the cluster`, { timeout }, async () => {
    const text = `x${cluster}y`;
    await withParagraph(text, [styled(0, 2)], (node, mounted) => {
      mounted.scene.updateMatrixWorld(true);
      assert.deepEqual(offsets(node), [[0, 1 + units]], `${label}: the cluster must join the span whole`);
      assertAligned(node, label);
      assert.equal(node.error, undefined, `${label}: ${String(node.error?.message)}`);
    });
  });
}

test('a mark at offset 0 has no base, so it is its own cluster and nothing moves', { timeout }, async () => {
  const text = `${ACUTE}ab`;
  assert.deepEqual(clusters(text), [0, 1, 2, 3], 'a leading mark stands alone under GB1');
  await withParagraph(text, [styled(0, 1)], (node, mounted) => {
    mounted.scene.updateMatrixWorld(true);
    assert.deepEqual(offsets(node), [[0, 1]]);
    assert.equal(node.error, undefined, `the paragraph stopped publishing: ${String(node.error?.message)}`);
  });
});

test('an authored empty span states nothing and never reaches the engine', { timeout }, async () => {
  await withParagraph('abc', [styled(1, 1), styled(0, 2)], (node, mounted) => {
    mounted.scene.updateMatrixWorld(true);
    assert.deepEqual(offsets(node), [
      [1, 1],
      [0, 2],
    ]);
    assert.equal(node.error, undefined, `an empty span must not fail the frame: ${String(node.error?.message)}`);
    assert.equal(node.inspectLayout().glyphCount, 3);
  });
});

test('nested spans both resolve, and stay nested', { timeout }, async () => {
  const text = `ab${ACUTE}cd`;
  assert.deepEqual(clusters(text), [0, 1, 3, 4, 5], 'b and the mark must fuse');
  // The outer span ends inside the fused cluster; the inner one is wholly inside the outer.
  await withParagraph(text, [styled(0, 2), styled(1, 2)], (node, mounted) => {
    mounted.scene.updateMatrixWorld(true);
    assert.deepEqual(offsets(node), [
      [0, 3],
      [1, 3],
    ]);
    assertAligned(node, 'nested');
    assert.equal(node.error, undefined, `the paragraph stopped publishing: ${String(node.error?.message)}`);
  });
});

test('a cluster-aligned span keeps its range, and what it retains cannot be mutated', { timeout }, async () => {
  const span = styled(0, 1);
  await withParagraph('abc', [span], (node, mounted) => {
    assert.deepEqual(offsets(node), [[0, 1]], 'an aligned authored span must keep its range');
    node.replaceText(2, 3, 'z');
    mounted.scene.updateMatrixWorld(true);
    assert.equal(node.text, 'abz');
    assert.deepEqual(offsets(node), [[0, 1]], 'an edit that moves no boundary must not move the span either');
    assert.equal(node.error, undefined, `the paragraph stopped publishing: ${String(node.error)}`);

    // The retained record is a frozen copy, not the caller's object. Handing the caller's own
    // mutable record back would let `spans[0].end = ...` change what the identity short-circuit
    // in `normalizeDesired` still trusts as resolved, reinstating a cluster-splitting span.
    assert.notEqual(node.spans[0], span, 'a retained span must not alias the caller record');
    assert.throws(
      () => {
        node.spans[0].end = 3;
      },
      TypeError,
      'a retained span must be frozen',
    );
    assert.deepEqual(offsets(node), [[0, 1]], 'the retained range must be unchanged by the attempt');
  });
});

test('an inverted authored range is not laundered into an empty span', { timeout }, async () => {
  // Resolution moves boundaries forward and clamps a well-formed range so it cannot invert. An
  // ALREADY inverted range is a caller arithmetic error, and range validity has its own owner.
  // Clamping it here would produce an empty span that the empty-span filter then discards, so the
  // fault would vanish instead of being reported.
  const font = await fonts.load('inter');
  const mounted = mount(font, [authored('abc', [styled(2, 1)])]);
  try {
    mounted.scene.updateMatrixWorld(true);
    assert.notEqual(mounted.nodes[0].error, undefined, 'an inverted span must not publish silently');
  } finally {
    unmount(mounted);
  }
});

test('an update that changes neither text nor spans re-resolves nothing', { timeout }, async () => {
  // Resolution is the only segmentation on this path, and it is skipped when the grid cannot have
  // moved. `spans` is frozen at normalize time, so its surviving identity is the observable proof
  // that the previous resolution was trusted rather than recomputed -- the deterministic stand-in
  // for a segmentation counter.
  await withParagraph(`a${ACUTE}bc`, [styled(0, 1)], (node, mounted) => {
    const resolved = node.spans;
    assert.deepEqual(offsets(node), [[0, 2]], 'the authored boundary must have been resolved once');
    node.set({ paint: { color: '#00ff2f' } });
    node.set({ style: { fontSize: 7, lineHeight: 1 } });
    mounted.scene.updateMatrixWorld(true);
    assert.equal(node.spans, resolved, 'an unrelated update must reuse the resolved span list');
    assert.equal(node.error, undefined, `the paragraph stopped publishing: ${String(node.error?.message)}`);
  });
});

test('a span survives its text being cleared to empty, and the paragraph still publishes', { timeout }, async () => {
  await withParagraph(`a${ACUTE}b`, [styled(0, 2)], (node, mounted) => {
    node.set({ text: '', spans: [styled(0, 0)] });
    mounted.scene.updateMatrixWorld(true);
    assert.equal(node.text, '');
    assert.deepEqual(offsets(node), [[0, 0]]);
    assert.equal(node.error, undefined, `an empty paragraph was rejected: ${String(node.error?.message)}`);
  });
});

test('deleting the whole text through the edit helpers leaves nothing to style', { timeout }, async () => {
  await withParagraph(`a${ACUTE}b`, [styled(0, 2)], (node, mounted) => {
    node.deleteText(0, 3);
    mounted.scene.updateMatrixWorld(true);
    assert.equal(node.text, '');
    // The caller deleted the text the span addressed; that removal is the caller's own act, not the
    // cluster resolution's, and it is the one case a span leaves the array.
    assert.deepEqual(offsets(node), []);
    assert.equal(node.error, undefined, `an empty paragraph was rejected: ${String(node.error?.message)}`);
  });
});

/**
 * The three edit helpers, each moving an aligned span boundary into a cluster the edit created.
 *
 * Every case starts cluster-aligned and legal, performs one legal call, and must end publishing.
 * `aligned` is what the boundaries must become under the base rule.
 */
const REBASE_CASES = [
  {
    label: 'insertText fuses a mark onto the last cluster of a span',
    text: 'abc',
    spans: [styled(0, 1)],
    edit: (node) => node.insertText(1, ACUTE),
    result: `a${ACUTE}bc`,
    aligned: [[0, 2]],
  },
  {
    label: 'insertText at the start of a span leaves an already-aligned boundary alone',
    text: 'abc',
    spans: [styled(1, 3)],
    edit: (node) => node.insertText(1, ACUTE),
    result: `a${ACUTE}bc`,
    // The mark attaches to the unstyled base before the span, so the span shifts and does not grow.
    aligned: [[2, 4]],
  },
  {
    label: 'replaceText substitutes a base with a mark, fusing it onto the span',
    text: 'abc',
    spans: [styled(0, 1)],
    edit: (node) => node.replaceText(1, 2, ACUTE),
    result: `a${ACUTE}c`,
    aligned: [[0, 2]],
  },
  {
    label: 'deleteText removes the base between a span and a mark, fusing them',
    text: `ax${ACUTE}b`,
    spans: [styled(0, 1)],
    edit: (node) => node.deleteText(1, 2),
    result: `a${ACUTE}b`,
    aligned: [[0, 2]],
  },
  {
    label: 'a surrogate pair inserted at a span boundary moves it without splitting it',
    text: 'abc',
    spans: [styled(0, 1)],
    edit: (node) => node.insertText(1, ASTRAL),
    result: `a${ASTRAL}bc`,
    // Offset 1 is still a cluster boundary, so nothing moves and the pair stays outside the span.
    aligned: [[0, 1]],
  },
  {
    label: 'a regional indicator inserted beside another fuses the pair into the span',
    text: `\u{1f1ef}z`,
    spans: [styled(0, 2)],
    edit: (node) => node.insertText(2, '\u{1f1f5}'),
    result: `${FLAG}z`,
    // The two indicators fuse into one flag cluster whose base the span already held.
    aligned: [[0, 4]],
  },
  {
    label: 'a ZWJ typed after a styled emoji pulls the next emoji into the same cluster',
    text: '\u{1f468}\u{1f469}',
    spans: [styled(0, 2)],
    edit: (node) => node.insertText(2, '‍'),
    result: '\u{1f468}‍\u{1f469}',
    aligned: [[0, 5]],
  },
  {
    label: 'a virama typed after a styled consonant fuses the conjunct',
    text: 'कष',
    spans: [styled(0, 1)],
    edit: (node) => node.insertText(1, '्'),
    result: CONJUNCT,
    aligned: [[0, 3]],
  },
  {
    label: 'a trailing jamo joins the syllable whose lead the span holds',
    text: '가',
    spans: [styled(0, 2)],
    edit: (node) => node.insertText(2, 'ᆨ'),
    result: JAMO,
    aligned: [[0, 3]],
  },
  {
    label: 'an edit that merges two spans keeps them adjacent rather than overlapping',
    text: 'axyb',
    spans: [styled(0, 2), styled(2, 4)],
    edit: (node) => node.replaceText(1, 3, ACUTE),
    result: `a${ACUTE}b`,
    // The first span's end moves forward onto the fused cluster; the second already sits on it, so
    // the two meet at 2 instead of overlapping across it.
    aligned: [
      [0, 2],
      [2, 3],
    ],
  },
  {
    label: 'an edit that deletes the text between two spans leaves them adjacent',
    text: 'abcd',
    spans: [styled(0, 2), styled(2, 4)],
    edit: (node) => node.deleteText(1, 3),
    result: 'ad',
    aligned: [
      [0, 1],
      [1, 2],
    ],
  },
  {
    label: 'a span whose last cluster is claimed by its neighbour collapses in place, and stays',
    text: `ax${ACUTE}b`,
    spans: [styled(0, 1), styled(1, 3)],
    edit: (node) => node.deleteText(1, 2),
    result: `a${ACUTE}b`,
    // Deleting the base 'x' orphans its mark onto 'a', whose cluster the first span already held.
    // The second span keeps no cluster of its own, so it is reported as empty rather than removed:
    // the loss stays visible and `setSpan(1, ...)` still addresses the same span.
    aligned: [
      [0, 2],
      [2, 2],
    ],
  },
];

for (const { label, text, spans, edit, result, aligned } of REBASE_CASES) {
  test(label, { timeout }, async () => {
    await withParagraph(text, spans, (node, mounted) => {
      assert.equal(node.error, undefined, `the starting paragraph was rejected: ${String(node.error)}`);
      edit(node);
      mounted.scene.updateMatrixWorld(true);
      assert.equal(node.text, result);
      assert.deepEqual(offsets(node), aligned);
      assertAligned(node, label);
      assert.equal(node.error, undefined, `the paragraph stopped publishing: ${String(node.error?.message)}`);
    });
  });
}

test('a collapsed span is still addressable by the index it always had', { timeout }, async () => {
  await withParagraph(`ax${ACUTE}b`, [styled(0, 1), styled(1, 3)], (node, mounted) => {
    node.deleteText(1, 2);
    mounted.scene.updateMatrixWorld(true);
    assert.deepEqual(offsets(node), [
      [0, 2],
      [2, 2],
    ]);
    // The collapsed span is still index 1, so a caller repairing it does not address its neighbour.
    node.setSpan(1, styled(2, 3));
    mounted.scene.updateMatrixWorld(true);
    assert.deepEqual(offsets(node), [
      [0, 2],
      [2, 3],
    ]);
    assert.equal(node.error, undefined, `the paragraph stopped publishing: ${String(node.error?.message)}`);
  });
});

test('splitting a surrogate pair is still rejected as a range fault', { timeout }, async () => {
  await withParagraph(`a${ASTRAL}b`, [styled(0, 1)], (node) => {
    assert.throws(() => node.replaceText(2, 2, 'z'), RangeError);
    assert.throws(() => node.deleteText(0, 2), RangeError);
    assert.equal(node.text, `a${ASTRAL}b`, 'a rejected range must not have edited anything');
  });
});

test('no seeded sequence of legal edits produces a paragraph the engine refuses', { timeout }, async () => {
  // The property the whole design exists for. Splices land on any SCALAR boundary, so an edit can
  // cut a cluster in half exactly as a caller's would, and the alphabet mixes bases, combining
  // marks, joiners, regional indicators, and an astral scalar. Spaces are excluded: a space
  // followed by a combining mark is a separate, pinned defect and would report a failure this test
  // is not for.
  const units = ['a', 'b', 'z', ACUTE, ASTRAL, '‍', '\u{1f1ef}', 'क', '्', 'ᄀ', 'ᅡ'];
  for (const seed of [1, 7, 13, 29]) {
    const random = seededRandom(seed);
    await withParagraph('abz', [styled(0, 1), styled(1, 3)], (node, mounted) => {
      for (let step = 0; step < 24; step += 1) {
        const bounds = [...scalarOffsets(node.text)];
        const start = bounds[Math.floor(random() * bounds.length)];
        const reachable = bounds.filter((offset) => offset >= start);
        const end = reachable[Math.floor(random() * reachable.length)];
        let insert = '';
        for (let count = Math.floor(random() * 3); count > 0; count -= 1) {
          insert += units[Math.floor(random() * units.length)];
        }
        node.replaceText(start, end, insert);
        mounted.scene.updateMatrixWorld(true);
        const where = `seed ${seed} step ${step} -> ${JSON.stringify(node.text)} ${JSON.stringify(offsets(node))}`;
        assertAligned(node, where);
        assert.equal(node.error, undefined, `${where}: ${String(node.error?.message)}`);
      }
    });
  }
});

test('no seeded sequence of authored span updates produces one either', { timeout }, async () => {
  // The declarative half of the same property: a React caller never calls `replaceText`, it re-
  // authors `text` and `spans` together. Boundaries are drawn on scalar offsets, so every update
  // here is a legal public call that can split a cluster.
  const units = ['a', ACUTE, ASTRAL, FLAG, CONJUNCT, JAMO, '‍\u{1f469}'];
  for (const seed of [3, 11]) {
    const random = seededRandom(seed);
    await withParagraph('abz', [styled(0, 1)], (node, mounted) => {
      for (let step = 0; step < 24; step += 1) {
        let text = '';
        for (let count = 1 + Math.floor(random() * 4); count > 0; count -= 1) {
          text += units[Math.floor(random() * units.length)];
        }
        const bounds = [...scalarOffsets(text)];
        const start = bounds[Math.floor(random() * bounds.length)];
        const reachable = bounds.filter((offset) => offset >= start);
        const end = reachable[Math.floor(random() * reachable.length)];
        node.set({ text, spans: [styled(start, end)] });
        mounted.scene.updateMatrixWorld(true);
        const where = `seed ${seed} step ${step} -> ${JSON.stringify(text)} ${JSON.stringify(offsets(node))}`;
        assertAligned(node, where);
        assert.equal(node.error, undefined, `${where}: ${String(node.error?.message)}`);
      }
    });
  }
});

function* scalarOffsets(text) {
  let offset = 0;
  for (const scalar of text) {
    yield offset;
    offset += scalar.length;
  }
  yield offset;
}

/**
 * The React surface, which is the one that cannot tolerate a throw.
 *
 * react-three-fiber constructs the underlying object from `args` inside a `useState` initializer,
 * BEFORE `onError` is attached, and applies later updates from a layout effect. A `Text` that threw
 * for a span splitting a cluster would therefore fail at MOUNT with no `text.error`, no group
 * error, and no `onError` delivery -- escaping scene traversal, which `docs/planning/three-api.md`
 * states errors never do. Resolving the boundary instead of rejecting it is what makes that
 * impossible, and this is the composition that would have proved it otherwise: the mark arrives as
 * a sibling child, so the span the adapter flattens ends one code unit inside the fused cluster.
 */
test('a nested React Text whose flattened span splits a cluster mounts and publishes', { timeout }, async () => {
  const { create } = (await import('@react-three/test-renderer/webgpu')).default;
  const font = await fonts.load('inter');
  const nodes = [];
  const errors = [];
  const renderer = await create(
    createElement(
      R3fText,
      {
        font,
        style: latin,
        contentBox: box,
        paint,
        onError: (error) => void errors.push(error),
        ref: (node) => void (node !== undefined && nodes.push(node)),
      },
      createElement(R3fText, { paint: { color: '#ff2f00' } }, 'a'),
      `${ACUTE}bc`,
    ),
  );
  try {
    const node = nodes.at(-1);
    assert.ok(node !== undefined, 'the object must have been constructed and published');
    assert.equal(node.text, `a${ACUTE}bc`);
    assert.deepEqual(offsets(node), [[0, 2]], 'the flattened span must resolve onto the fused cluster');
    assert.deepEqual(errors, [], 'nothing may reach onError for a resolvable span');
    assert.equal(node.error, undefined, `the paragraph stopped publishing: ${String(node.error?.message)}`);
  } finally {
    await renderer.unmount();
  }
});
