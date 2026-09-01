/**
 * One style per extended grapheme cluster, held at the `Text` boundary.
 *
 * The shaper resolves exactly one style per cluster and rejects any frame whose styles split one
 * (`cluster_state.rs`, `build`). Reaching that rejection costs a full publish and returns a numeric
 * engine status naming no span, so `Text` resolves every span boundary onto the cluster grid before
 * a frame is built, under one rule stated constructively rather than as a rejection:
 *
 *   A CLUSTER TAKES THE STYLE OF ITS BASE. Every boundary moves forward to the end of the cluster
 *   containing it, so the marks that attach to a base follow the base's style.
 *
 * The rule has exactly two entry points, and both are covered here:
 *
 *   1. The `spans` ARRAY, the one surface that carries raw offsets. Those numbers are the caller's
 *      own arithmetic, and `alignSpansToClusters` -- the same function the library applies -- is
 *      exported so a caller can ask for the answer instead of accepting it silently.
 *   2. The TREE COMPILERS. `txt`/`span` and nested React `<Text>` compile a document that states no
 *      offsets at all; each derives a boundary at a concatenation JOIN, and concatenation can fuse
 *      the tail of one fragment with the head of the next into one cluster. Both resolve that join
 *      themselves, against the text they just produced, so neither can emit a boundary the engine
 *      would refuse and the array backstop has nothing left to discover.
 *
 * A span that loses every cluster it covered collapses to an empty range and is KEPT, so that
 * `Text.spans` still reports it and no style disappears without a trace in the array. An empty span
 * states nothing and is not compiled into an engine style.
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
import { glyph, txt } from '@pmndrs/glyph';
import { alignSpansToClusters } from '../../dist/formatted-text.js';
import { span } from '@pmndrs/glyph';
import { Text as R3fText } from '@pmndrs/glyph/react';
import { ThreeConfig } from '@pmndrs/glyph/three';

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
await glyph.init();
const r3fHandle = glyph.handle('three:text-mutation-span-tests', ThreeConfig);
after(() => {
  fonts.dispose();
  r3fHandle.dispose();
});

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

const constraints = { width: { mode: 'exact', size: 220 } };
const layout = { wrap: 'word' };
const paint = { color: '#ffffff' };
const latin = { fontSize: 6, lineHeight: 1 };

const styled = (start, end) => ({ start, end, style: { color: '#ff2f00' } });
const authored = (text, spans = []) => ({
  properties: { constraints, layout, spans, style: [latin, paint], text },
});

const offsets = (node) => node.spans.map((entry) => [entry.start, entry.end]);
const clusters = (text) => [...findGraphemeBoundaries(text)];

/** Every span boundary is a cluster boundary. */
function assertAligned(node, context) {
  const boundaries = new Set(findGraphemeBoundaries(node.text));
  for (const [index, entry] of node.spans.entries()) {
    assert.ok(entry.start <= entry.end, `${context}: span ${index} inverted to [${entry.start}, ${entry.end})`);
    assert.ok(boundaries.has(entry.start), `${context}: span ${index} starts at ${entry.start}, inside a cluster`);
    assert.ok(boundaries.has(entry.end), `${context}: span ${index} ends at ${entry.end}, inside a cluster`);
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
    resolved.map((entry) => [entry.start, entry.end]),
    [[0, 2]],
  );
  assert.equal(resolved[0].style, split[0].style, 'resolution must carry every other property through');
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
    assert.equal(node.measure().glyphCount, 3);
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
  const authoredSpan = styled(0, 1);
  await withParagraph('abc', [authoredSpan], (node, mounted) => {
    assert.deepEqual(offsets(node), [[0, 1]], 'an aligned authored span must keep its range');
    node.set({ text: 'abz', spans: [authoredSpan] });
    mounted.scene.updateMatrixWorld(true);
    assert.equal(node.text, 'abz');
    assert.deepEqual(offsets(node), [[0, 1]], 'a change that moves no boundary must not move the span either');
    assert.equal(node.error, undefined, `the paragraph stopped publishing: ${String(node.error)}`);

    // The retained record is a frozen copy, not the caller's object. Handing the caller's own
    // mutable record back would let `spans[0].end = ...` change what the identity short-circuit
    // in `normalizeDesired` still trusts as resolved, reinstating a cluster-splitting span.
    assert.notEqual(node.spans[0], authoredSpan, 'a retained span must not alias the caller record');
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

test('an inverted authored range is rejected where the caller wrote it', { timeout }, async () => {
  // Resolution moves boundaries forward and clamps a well-formed range so it cannot invert. An
  // ALREADY inverted range is a caller arithmetic error: there is no range the caller meant, so
  // nothing can repair it. Clamping it would produce an empty span the empty-span filter discards
  // and the fault would vanish; forwarding it produced a frame the engine refused every frame with
  // a numeric status naming nothing. It throws from construction instead, where the stack points
  // at the caller (D-268).
  const font = await fonts.load('inter');
  assert.throws(() => mount(font, [authored('abc', [styled(2, 1)])]), /span 0 is inverted/);
});

test('an update that changes neither text nor spans re-resolves nothing', { timeout }, async () => {
  // Resolution is the only segmentation on this path, and it is skipped when the grid cannot have
  // moved. `spans` is frozen at normalize time, so its surviving identity is the observable proof
  // that the previous resolution was trusted rather than recomputed -- the deterministic stand-in
  // for a segmentation counter.
  await withParagraph(`a${ACUTE}bc`, [styled(0, 1)], (node, mounted) => {
    const resolved = node.spans;
    assert.deepEqual(offsets(node), [[0, 2]], 'the authored boundary must have been resolved once');
    node.set({ style: { color: '#00ff2f' } });
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

test('clearing the text without restating spans leaves nothing to style', { timeout }, async () => {
  await withParagraph(`a${ACUTE}b`, [styled(0, 2)], (node, mounted) => {
    node.text = '';
    mounted.scene.updateMatrixWorld(true);
    assert.equal(node.text, '');
    // Replacement text carries its own formatting, so an update that states text without stating
    // spans clears the ones it replaced. That removal is the caller's own act, not the cluster
    // resolution's, and it is the one case a span leaves the array.
    assert.deepEqual(offsets(node), []);
    assert.equal(node.error, undefined, `an empty paragraph was rejected: ${String(node.error?.message)}`);
  });
});

/**
 * One authored paragraph per fusion mechanism, each with a boundary one code unit inside a cluster.
 *
 * These are the shapes a caller produces by re-authoring `text` and `spans` together: the string
 * gains a scalar that fuses with its neighbour, and a range that was cluster-aligned against the
 * previous string is no longer aligned against this one. Each must publish, with the fused cluster
 * taking the style of its base. `aligned` is what the boundaries must become under that rule.
 */
const AUTHORED_CASES = [
  {
    label: 'a mark fused onto the last cluster a span held joins the span',
    text: `a${ACUTE}bc`,
    spans: [styled(0, 1)],
    aligned: [[0, 2]],
  },
  {
    label: 'a mark fused onto the base before a span leaves that span where it is',
    text: `a${ACUTE}bc`,
    // The mark attaches to the unstyled base before the span, so offset 2 is already a boundary.
    spans: [styled(2, 4)],
    aligned: [[2, 4]],
  },
  {
    label: 'a surrogate pair beside a span boundary moves nothing',
    text: `a${ASTRAL}bc`,
    // Offset 1 is still a cluster boundary, so the pair stays outside the span rather than joining.
    spans: [styled(0, 1)],
    aligned: [[0, 1]],
  },
  {
    label: 'a regional indicator pair joins the span holding its first half',
    text: `${FLAG}z`,
    spans: [styled(0, 2)],
    aligned: [[0, 4]],
  },
  {
    label: 'a ZWJ sequence joins the span holding its first emoji',
    text: FAMILY,
    spans: [styled(0, 2)],
    aligned: [[0, 8]],
  },
  {
    label: 'a Devanagari conjunct joins the span holding its first consonant',
    text: CONJUNCT,
    spans: [styled(0, 1)],
    aligned: [[0, 3]],
  },
  {
    label: 'a Hangul syllable joins the span holding its lead jamo',
    text: JAMO,
    spans: [styled(0, 2)],
    aligned: [[0, 3]],
  },
  {
    label: 'two spans meeting inside a fused cluster stay adjacent rather than overlapping',
    text: `a${ACUTE}b`,
    // The first span's end moves forward onto the fused cluster; the second's start moves with it,
    // so the two still meet at one offset instead of overlapping across it.
    spans: [styled(0, 1), styled(1, 3)],
    aligned: [
      [0, 2],
      [2, 3],
    ],
  },
  {
    label: 'a span whose only cluster is claimed by its neighbour collapses in place, and stays',
    text: `a${ACUTE}b`,
    // The mark attaches to 'a', whose cluster the first span already holds. The second span keeps
    // no cluster of its own, so it is reported as empty rather than removed: the loss stays visible
    // and every later span keeps the index it always had.
    spans: [styled(0, 1), styled(1, 2)],
    aligned: [
      [0, 2],
      [2, 2],
    ],
  },
];

for (const { label, text, spans, aligned } of AUTHORED_CASES) {
  test(label, { timeout }, async () => {
    await withParagraph(text, spans, (node, mounted) => {
      mounted.scene.updateMatrixWorld(true);
      assert.equal(node.text, text);
      assert.deepEqual(offsets(node), aligned);
      assertAligned(node, label);
      assert.equal(node.error, undefined, `the paragraph stopped publishing: ${String(node.error?.message)}`);
    });
  });
}

test('a collapsed span is still addressable by the index it always had', { timeout }, async () => {
  await withParagraph(`a${ACUTE}b`, [styled(0, 1), styled(1, 2)], (node, mounted) => {
    mounted.scene.updateMatrixWorld(true);
    assert.deepEqual(offsets(node), [
      [0, 2],
      [2, 2],
    ]);
    // The collapsed span is still index 1, so a caller repairing it does not address its neighbour.
    node.spans = [styled(0, 1), styled(2, 3)];
    mounted.scene.updateMatrixWorld(true);
    assert.deepEqual(offsets(node), [
      [0, 2],
      [2, 3],
    ]);
    assert.equal(node.error, undefined, `the paragraph stopped publishing: ${String(node.error?.message)}`);
  });
});

test('a boundary inside a surrogate pair resolves like any other', { timeout }, async () => {
  // A span offset addresses no scalar of its own, so an offset between the halves of a pair falls
  // inside the cluster that pair forms and resolves to its end like any other interior offset.
  // Nothing in the public surface takes an offset that could split a scalar any more, so there is
  // no separate scalar-splitting fault left for a caller to trip over.
  await withParagraph(`a${ASTRAL}b`, [styled(0, 2)], (node, mounted) => {
    mounted.scene.updateMatrixWorld(true);
    assert.deepEqual(offsets(node), [[0, 3]], 'the pair must join the span whole');
    assertAligned(node, 'surrogate pair');
    assert.equal(node.error, undefined, `the paragraph stopped publishing: ${String(node.error?.message)}`);
  });
});

/**
 * The tree compilers, which are the surface a caller cannot state an offset through at all.
 *
 * `txt`/`span` and nested React `<Text>` compile a document tree into `(text, spans)`, deriving
 * every boundary at a concatenation JOIN. Concatenation can fuse the tail of one fragment with the
 * head of the next into a single extended grapheme cluster, and the join then names an offset that
 * is not a boundary of the text the compiler just produced -- a paragraph the engine refuses, out
 * of a document that stated no numbers. Both compilers resolve their own joins, under one shared
 * rule, so the array backstop has nothing left to discover.
 */
test('a txt fragment opening with a combining mark compiles onto its base cluster', { timeout }, async () => {
  // 'a' is authored plain and the mark plus 'b' styled. Concatenation fuses 'a' with the mark, so
  // the join at offset 1 is inside the resulting cluster and cannot be published as authored.
  const literal = txt`a${span({ color: '#ff2f00' })`${ACUTE}b`}`;
  assert.equal(literal.text, `a${ACUTE}b`);
  assert.deepEqual(clusters(literal.text), [0, 2, 3], 'the base and the mark must have fused');
  assert.deepEqual(
    literal.spans.map((entry) => [entry.start, entry.end]),
    [[2, 3]],
    'the join must resolve onto the cluster its base owns, leaving the mark with the base style',
  );
  // The array backstop is what a caller applies to its OWN offsets. It must find nothing to move
  // here, which is the whole claim: the compiler no longer emits a boundary for it to discover.
  assert.equal(
    alignSpansToClusters(literal.text, literal.spans),
    literal.spans,
    'a compiled literal must already be resolved when it reaches the backstop',
  );

  const font = await fonts.load('inter');
  const mounted = mount(font, [{ properties: { constraints, layout, style: [latin, paint], text: literal } }]);
  try {
    const node = mounted.nodes[0];
    mounted.scene.updateMatrixWorld(true);
    assert.deepEqual(offsets(node), [[2, 3]]);
    assertAligned(node, 'txt fragment');
    assert.equal(node.error, undefined, `the paragraph stopped publishing: ${String(node.error?.message)}`);
  } finally {
    unmount(mounted);
  }
});

test('a nested span fragment resolves against the text it is embedded in', { timeout }, async () => {
  // The join no inner pass could settle. The inner fragment is composed against its own cluster
  // grid, where its leading mark stands alone; 'a' and that mark fuse only once the two fragments
  // are concatenated, so the outer resolution is what owns this boundary.
  const inner = span({ color: '#00ff2f' })`${ACUTE}b`;
  const literal = txt`${span({ color: '#ff2f00' })`a${inner}`}c`;
  assert.equal(literal.text, `a${ACUTE}bc`);
  assert.deepEqual(clusters(literal.text), [0, 2, 3, 4]);
  assert.deepEqual(
    literal.spans.map((entry) => [entry.start, entry.end]),
    [
      // The outer span holds the fused cluster, because its base is the outer fragment's 'a'.
      [0, 3],
      [2, 3],
    ],
    'both joins must resolve, and the nesting must survive',
  );
  assert.equal(alignSpansToClusters(literal.text, literal.spans), literal.spans);
});

test('no seeded sequence of authored span updates produces a paragraph the engine refuses', { timeout }, async () => {
  // The property the whole design exists for, over the surface that still exists: a caller re-
  // authors `text` and `spans` together. Boundaries are drawn on scalar offsets, so an update can
  // cut a cluster in half exactly as a text editor's would, and the alphabet mixes bases, combining
  // marks, joiners, regional indicators, and an astral scalar. Spaces are excluded: a space
  // followed by a combining mark is a separate, pinned defect and would report a failure this test
  // is not for.
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
        handle: r3fHandle,
        font,
        style: [latin, paint],
        constraints,
        layout,
        onError: (error) => void errors.push(error),
        ref: (node) => void (node !== undefined && nodes.push(node)),
      },
      createElement(R3fText, { style: { color: '#ff2f00' } }, 'a'),
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

/**
 * The same compiler defect as the `txt` case above, on the React tree.
 *
 * The caller writes 'a' plain and a nested `<Text>` whose own text opens with a combining mark. No
 * offset appears anywhere in the document; `flattenText` derives the span's start at the join, and
 * concatenation fuses 'a' with the mark. The nested element's style therefore begins after the
 * fused cluster, which stays with the base its own child wrote.
 */
test('a nested React Text opening with a combining mark compiles onto its base cluster', { timeout }, async () => {
  const { create } = (await import('@react-three/test-renderer/webgpu')).default;
  const font = await fonts.load('inter');
  const nodes = [];
  const errors = [];
  const renderer = await create(
    createElement(
      R3fText,
      {
        handle: r3fHandle,
        font,
        style: [latin, paint],
        constraints,
        layout,
        onError: (error) => void errors.push(error),
        ref: (node) => void (node !== undefined && nodes.push(node)),
      },
      'a',
      createElement(R3fText, { style: { color: '#ff2f00' } }, `${ACUTE}b`),
    ),
  );
  try {
    const node = nodes.at(-1);
    assert.ok(node !== undefined, 'the object must have been constructed and published');
    assert.equal(node.text, `a${ACUTE}b`);
    assert.deepEqual(clusters(node.text), [0, 2, 3], 'the base and the mark must have fused');
    assert.deepEqual(offsets(node), [[2, 3]], 'the flattened start must resolve past the fused cluster');
    assertAligned(node, 'nested React Text');
    assert.deepEqual(errors, [], 'nothing may reach onError for a resolvable span');
    assert.equal(node.error, undefined, `the paragraph stopped publishing: ${String(node.error?.message)}`);
  } finally {
    await renderer.unmount();
  }
});

test('a nested React Text rejects box-only props before constructing a paragraph', { timeout }, async () => {
  const { create } = (await import('@react-three/test-renderer/webgpu')).default;
  const font = await fonts.load('inter');
  await assert.rejects(
    async () =>
      create(
        createElement(
          R3fText,
          { font, handle: r3fHandle, style: latin, constraints, layout },
          createElement(R3fText, { position: [1, 2, 3] }, 'invalid inline box'),
        ),
      ),
    /nested R3F Text cannot use the box property position/,
  );
});
