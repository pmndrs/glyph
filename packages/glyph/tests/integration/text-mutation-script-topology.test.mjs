/**
 * Incremental text mutation where the SHAPING-RUN TOPOLOGY changes, verified through to the GPU.
 *
 * `text-mutation-gpu-lanes.test.mjs` drives the same differential oracle over Latin text, where a
 * grapheme, a scalar, and a glyph are almost always the same thing. The defect class this file
 * exists for is the one where they are not: the engine computes a glyph's semantic change mask in
 * IDENTITY space, against that glyph's own previous record slot, while the gather that consumes the
 * mask walks SLOT space. The two agree only while a slot keeps its occupant. Every mechanism that
 * moves an occupant between slots is a script mechanism:
 *
 *   - bidi reordering, where an edit anywhere on a mixed-direction line renumbers visual order;
 *   - ligature absorption, where one glyph swallows or releases a whole grapheme cluster;
 *   - Devanagari cluster reordering, where a pre-base matra typed at the TAIL of a cluster renders
 *     at its HEAD, so a tail insertion displaces a glyph that precedes it;
 *   - conjunct formation and splitting, where a single virama changes the glyph count of a cluster.
 *
 * `engine-sequence-property.test.mjs` already drives randomized edits over these same fixtures, and
 * never saw the defect, because its oracle is engine-only: it asks whether `layout` agrees
 * with `layout`. Both read the engine, and both were correct. This file points the
 * differential/packed-lane oracle -- construction from scratch, compared bit-for-bit including the
 * instanced attributes the GPU samples -- at the same fixture classes.
 *
 * Every corpus string here is a substring of the authored Advanced-shaping corpus in
 * `apps/benchmarks/src/workloads/advanced-shaping/scene.ts`, which the conformance target already
 * shapes against these exact baked fixtures with `missingGlyphCount === 0`. `assertShaped` re-proves
 * that here, so a green run cannot be a green blank.
 *
 * Sequences are seeded and fixed. A failure names the case, the edit, and the step that reproduce
 * it, with no wall-clock input and no `Math.random`.
 *
 * NOT COVERED, deliberately:
 *
 *   - Multi-scalar grapheme clusters in the Japanese corpus. Every unit in the authored CJK text is
 *     a single precomposed scalar, and combining voiced-sound marks (U+3099/U+309A) are not in the
 *     `noto-sans-cjk-showcase` subset, so a CJK edit cannot land strictly inside a grapheme cluster.
 *     Mid-cluster editing is covered instead by the scalar-boundary sequences over Devanagari and
 *     Arabic, whose clusters really are multi-scalar.
 *   - Devanagari and CJK through the Slug and MSDF packing policies. Slug lane coverage of
 *     topology change is carried by the three Amiri cases, which cover bidi reorder and ligature
 *     absorption; adding two more baked fixtures per script would multiply bake cost without
 *     reaching a different code path, since the packing policy is chosen per technique and not per
 *     script.
 *   - The stable-indirect allocation policy, for the reason documented in
 *     `text-mutation-gpu-lanes.test.mjs`: no first-party path from `Text`/`TextGroup` selects it.
 */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';

import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { slug } from '@pmndrs/glyph/three/slug';

import {
  assertMatchesFreshBuild,
  assertShaped,
  createFontCache,
  edit,
  IDENTITY_LANE,
  lanes,
  mount,
  seededRandom,
  timeout,
  unmount,
} from '../support/text-mutation-lanes.mjs';

// The engine's own grapheme segmentation. `Intl.Segmenter` is a DIFFERENT implementation of UAX #29
// and the two disagree on degenerate sequences, so snapping a span boundary with ICU can still land
// it inside a cluster the engine sees -- which the engine rejects outright.
import { findGraphemeBoundaries, findLineBreaks } from '../../dist/internal/unicode.js';

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const bitmap16 = { technique: bitmap, options: { strikes: [16] } };

const FIXTURES = {
  'amiri-bitmap': { file: 'amiri-bitmap-16.font.glb', raster: bitmap16 },
  'amiri-slug': { file: 'amiri-slug.font.glb.gz', raster: { technique: slug } },
  devanagari: { file: 'noto-sans-devanagari-bitmap-16.font.glb', raster: bitmap16 },
  cjk: { file: 'noto-sans-cjk-showcase-bitmap-16.font.glb', raster: bitmap16 },
  'dot-gothic': { file: 'dot-gothic-16-bitmap-16.font.glb', raster: bitmap16 },
};

const fonts = createFontCache(FIXTURES);
after(() => fonts.dispose());

/** Wide enough for the long corpora to wrap rather than clip every case into the same overflow. */
const wrappingFlow = { constraints: { width: { mode: 'exact', size: 220 } }, layout: { wrap: 'word' } };
/** The product-shaped box from the reported regression: centered, single line, clipped. */
const clippedFlow = {
  constraints: { width: { mode: 'exact', size: 220 } },
  layout: { align: 'center', maxLines: 1, overflow: 'clip', wrap: 'none' },
};
const paint = { color: '#ffffff' };

/**
 * Author one paragraph.
 *
 * Style carries the case's direction, language, and features, because those are shaping inputs and
 * a run-topology case means nothing under the wrong ones. Features are dropped for empty text: the
 * engine validates an unbounded feature as a non-empty UTF-16 range over the paragraph, which an
 * empty paragraph cannot satisfy, and the shipped Advanced-shaping target drops them for the same
 * reason.
 *
 * Spans are derived from the text rather than fixed, so an edited node and a node freshly built
 * with the same text always carry identical authored style -- the comparison stays a test of the
 * incremental path, not of two different documents.
 */
function paragraph(shaping, text, { flow = wrappingFlow, position, rasterPixelRatio, styled = false } = {}) {
  return {
    position,
    properties: {
      ...flow,
      spans: styled ? spansFor(text) : [],
      style: [
        {
          fontSize: 6,
          lineHeight: 1,
          direction: shaping.direction,
          language: shaping.language,
          ...(text.length === 0 || shaping.features === undefined ? {} : { features: shaping.features }),
        },
        paint,
      ],
      text,
      ...(rasterPixelRatio === undefined ? {} : { rasterPixelRatio }),
    },
  };
}

/**
 * Two leading runs in different colours and sizes; the remainder keeps the paragraph defaults.
 *
 * Boundaries are code-unit thirds SNAPPED OUTWARD TO GRAPHEME BOUNDARIES. The engine requires every
 * grapheme cluster to resolve to exactly one style and rejects the frame otherwise
 * (`cluster_state.rs`, `build`), which the roadmap records as validating span boundaries against
 * extended grapheme clusters. On Latin text a third almost always lands on a boundary already; on
 * these scripts it almost never does, so an unsnapped third would make every styled case fail as an
 * invalid request instead of testing the incremental path.
 *
 * A boundary inside a LIGATURE is not snapped and does not need to be: styling splits the shaping
 * run, the ligature simply does not form, and `latin-ligature` covers that on purpose.
 */
function spansFor(text) {
  const boundaries = [...findGraphemeBoundaries(text)];
  const snap = (offset) => boundaries.find((boundary) => boundary >= offset) ?? text.length;
  const first = snap(Math.floor(text.length / 3));
  const second = snap(first + 1);
  if (first === 0 || second <= first || second >= text.length) return [];
  return [
    { start: 0, end: first, style: { ...{ fontSize: 9, lineHeight: 1 }, ...{ color: '#ff2f00' } } },
    { start: first, end: second, style: { ...{ fontSize: 4, lineHeight: 1 }, ...{ color: '#0040ff' } } },
  ];
}

/**
 * The script cases.
 *
 * `alphabet` is the pool a seeded sequence may splice in. Every entry is drawn from the same
 * authored corpus as the case's edits, so a randomized sequence can never wander outside the baked
 * fixture's coverage and turn a topology assertion into a `.notdef` assertion.
 */
const CASES = [
  {
    id: 'arabic-joining',
    fixtures: ['amiri-bitmap', 'amiri-slug'],
    direction: 'rtl',
    language: 'ar',
    // Arabic letters take initial, medial, final, or isolated forms from their NEIGHBOURS, so an
    // edit at one offset changes the glyph chosen at the offsets around it. Every case below moves
    // more glyphs than the edit touches.
    edits: [
      ['deletion inside a joined word reshapes its neighbours', 'العربي', 'العبي'],
      ['deletion at the prefix reshapes the following letter', 'العربي', 'لعربي'],
      ['deletion at the suffix reshapes the preceding letter', 'العربي', 'العرب'],
      ['insertion inside a joined word reshapes its neighbours', 'العبي', 'العربي'],
      ['insertion at the prefix reshapes the following letter', 'عربي', 'العربي'],
      ['substitution changes a neighbour from final to medial form', 'العربي', 'العنبي'],
      ['lam-alef ligature forms, absorbing two scalars into one glyph', 'ولب', 'ولا'],
      ['lam-alef ligature breaks, releasing a scalar into its own glyph', 'ولا', 'ولب'],
      ['lam-alef ligature split by an inserted letter', 'ولا', 'ولسا'],
      ['collapse to a single letter', 'العربي', 'ا'],
      ['shrink to empty', 'العربي', ''],
      ['grow from empty', '', 'العربي'],
    ],
    alphabet: [...'النصالعربييتدفقبوضوح'],
    anchors: ['النص', 'بوضوح'],
    seed: 'العربي',
  },
  {
    id: 'mixed-bidi',
    fixtures: ['amiri-bitmap', 'amiri-slug'],
    direction: 'rtl',
    language: 'ar',
    // The paragraph resolves right-to-left, so a Latin or digit run inside it is an embedded
    // left-to-right island. Changing the length of any run renumbers the VISUAL order of every
    // glyph on the line, while logical order changes only at the edit site.
    edits: [
      ['latin island deleted from an rtl paragraph', 'PMNDRS النص العربي', 'النص العربي'],
      ['latin island inserted into an rtl paragraph', 'النص العربي', 'PMNDRS النص العربي'],
      ['latin island grows, moving the direction boundary', 'PMNDR النص', 'PMNDRS النص'],
      ['latin island shrinks, moving the direction boundary', 'PMNDRS النص', 'PMNDR النص'],
      ['digit run grows inside an rtl paragraph', 'النص 26 العربي', 'النص 2026 العربي'],
      ['digit run shrinks inside an rtl paragraph', 'النص 2026 العربي', 'النص 26 العربي'],
      ['rtl run inserted between two latin islands', 'PMNDRS 2026', 'PMNDRS النص 2026'],
      ['rtl run deleted from between two latin islands', 'PMNDRS النص 2026', 'PMNDRS 2026'],
      ['substitution at the direction boundary', 'PMNDRS النص', 'PMNDRT النص'],
      ['the whole rtl half is deleted, collapsing the paragraph to one direction', 'PMNDRS النص', 'PMNDRS'],
      ['the whole latin half is deleted, collapsing the paragraph to one direction', 'PMNDRS النص', 'النص'],
    ],
    alphabet: [...'PMNDRS 2026النصالعربي'],
    anchors: ['PMNDRS', 'النص العربي'],
    seed: 'PMNDRS 2026 النص',
  },
  {
    id: 'latin-ligature',
    fixtures: ['amiri-bitmap', 'amiri-slug'],
    direction: 'ltr',
    language: 'en',
    features: [
      { tag: 'kern', value: 1 },
      { tag: 'liga', value: 1 },
    ],
    // Amiri applies `liga` to Latin f-pairs, so one glyph absorbs or releases a grapheme cluster.
    // `ligature` below names the precondition this whole group depends on.
    ligature: { ligated: 'office', plain: 'once' },
    edits: [
      ['ligature forms by insertion, absorbing a cluster', 'ofice', 'office'],
      ['ligature breaks by deletion, releasing a cluster', 'office', 'ofice'],
      ['ligature split by a letter inserted between its members', 'office', 'ofxfice'],
      ['ligature rejoined by deleting the letter that split it', 'ofxfice', 'office'],
      ['ligature grows from a pair to a triple', 'offce', 'office'],
      ['ligature shrinks from a triple to a pair', 'office', 'offce'],
      ['ligature released at the tail', 'off', 'of'],
      ['ligature formed at the tail', 'of', 'off'],
      ['substitution breaks a ligature without changing length', 'office', 'oflice'],
      ['prefix deletion shifts every ligature left', 'the office', 'office'],
      ['prefix insertion shifts every ligature right', 'office', 'the office'],
    ],
    alphabet: [...'office fl affinity '],
    anchors: ['affinity', 'fine forms'],
    seed: 'office',
  },
  {
    id: 'indic-reordering',
    fixtures: ['devanagari'],
    direction: 'ltr',
    language: 'hi',
    // Devanagari is the sharpest case for identity-space vs slot-space. `ि` (matra i) is typed
    // AFTER its consonant and rendered BEFORE it, so an insertion at the tail of a cluster displaces
    // a glyph that precedes it. `्` (virama) joins two consonants into a conjunct, so deleting
    // one scalar changes the glyph count of the cluster around it.
    edits: [
      ['virama deleted, splitting a conjunct into two glyphs', 'कर्म', 'करम'],
      ['virama inserted, fusing two consonants into a conjunct', 'करम', 'कर्म'],
      ['pre-base matra appended, rendering before the consonant it follows', 'गत', 'गति'],
      ['pre-base matra deleted, unreordering the cluster', 'गति', 'गत'],
      ['pre-base matra appended inside a word', 'प्रगत', 'प्रगति'],
      ['deletion inside a conjunct cluster', 'क्षेत्र', 'क्षेत'],
      ['insertion rebuilding a conjunct cluster', 'क्षेत', 'क्षेत्र'],
      ['leading cluster deleted, shifting every later cluster', 'कर्म क्षेत्र', 'क्षेत्र'],
      ['leading cluster inserted, shifting every later cluster', 'क्षेत्र', 'कर्म क्षेत्र'],
      ['word inserted between two clusters', 'कर्म प्रगति', 'कर्म में प्रगति'],
      ['word deleted from between two clusters', 'कर्म में प्रगति', 'कर्म प्रगति'],
      ['collapse to a single consonant', 'कर्म क्षेत्र', 'क'],
      ['shrink to empty', 'कर्म क्षेत्र', ''],
      ['grow from empty', '', 'कर्म क्षेत्र'],
    ],
    alphabet: [...'कर्म क्षेत्र में प्रगति'],
    anchors: ['कर्म', 'प्रगति'],
    seed: 'क्षेत्र',
  },
  {
    id: 'cjk-line-breaks',
    fixtures: ['cjk', 'dot-gothic'],
    direction: 'ltr',
    language: 'ja',
    // No spaces, so every break is found by search rather than at a word boundary, and a one-scalar
    // edit can move the break for the whole remainder of the paragraph.
    edits: [
      [
        'deletion inside a spaceless run moves every later break',
        '文字組版では、空白なしでも自然に改行します。',
        '文字組版では、空白でも自然に改行します。',
      ],
      [
        'insertion inside a spaceless run moves every later break',
        '文字組版では、空白でも自然に改行します。',
        '文字組版では、空白なしでも自然に改行します。',
      ],
      [
        'punctuation removed, changing where the line may break',
        '文字組版では、空白なしでも自然に改行します。',
        '文字組版では空白なしでも自然に改行します。',
      ],
      [
        'punctuation inserted, changing where the line may break',
        '文字組版では空白なしでも自然に改行します',
        '文字組版では、空白なしでも自然に改行します。',
      ],
      ['prefix deletion', '文字組版では、空白なしでも自然に改行します。', '空白なしでも自然に改行します。'],
      ['suffix deletion', '文字組版では、空白なしでも自然に改行します。', '文字組版では、'],
      ['tail insertion', '文字組版では、', '文字組版では、空白なしでも自然に改行します。'],
      ['same-length substitution', '文字組版では、空白なし', '文字組版では、改行なし'],
      ['collapse to one character', '文字組版では、空白なし', '文'],
      ['shrink to empty', '文字組版では、空白なし', ''],
      ['grow from empty', '', '文字組版では、空白なし'],
    ],
    alphabet: [...'文字組版では、空白なしでも自然に改行します。'],
    anchors: ['文字組版', '改行します'],
    seed: '空白なしでも',
  },
];

/**
 * A three-node group with per-span colours and sizes and per-node raster pixel ratios.
 *
 * One paragraph in uniform white at one size leaves the foreground, `fontSize`, and
 * `transformIndex` lanes constant, so a slot corrupted in exactly those lanes reads back correct by
 * accident. Distinct positions, sizes, and colours make each of those lanes carry a value that
 * identifies its own slot. The edit lands on the middle node, so the nodes around it must keep
 * their own lanes while the record run under them shifts.
 */
function styledScene(shaping, texts) {
  return texts.map((text, index) =>
    paragraph(shaping, text, {
      position: [index * 24, index * -12, index * 3],
      rasterPixelRatio: 1 + index,
      styled: true,
    }),
  );
}

for (const shaping of CASES) {
  for (const fixture of shaping.fixtures) {
    const where = `${shaping.id} on ${fixture}`;

    if (shaping.ligature !== undefined) {
      // An authenticated fixture precondition. If this fixture stopped substituting the ligature,
      // every case in this group would still pass while exercising nothing it claims to.
      test(`${where}: the fixture actually substitutes the ligature these cases depend on`, { timeout }, async () => {
        const font = await fonts.load(fixture);
        const { ligated: text, plain: prefix } = shaping.ligature;
        const ligated = mount(font, [paragraph(shaping, text)]);
        const plain = mount(font, [paragraph(shaping, prefix)]);
        try {
          assertShaped(ligated, `${where} ligature precondition`);
          assertShaped(plain, `${where} ligature precondition`);
          const ligatedGlyphs = ligated.nodes[0].measure().glyphCount;
          const plainGlyphs = plain.nodes[0].measure().glyphCount;
          assert.ok(
            ligatedGlyphs < text.length,
            `${where}: ${JSON.stringify(text)} shaped ${ligatedGlyphs} glyphs for ${text.length} scalars, so no ligature absorbed a cluster`,
          );
          assert.equal(
            plainGlyphs,
            prefix.length,
            `${where}: ${JSON.stringify(prefix)} must shape one glyph per scalar, so the pair above is a real contrast`,
          );
        } finally {
          unmount(ligated);
          unmount(plain);
        }
      });
    }

    for (const [label, from, to] of shaping.edits) {
      test(`${where}: ${label}`, { timeout }, async () => {
        const font = await fonts.load(fixture);
        const mounted = mount(font, [paragraph(shaping, from)]);
        try {
          if (from.length > 0) assertShaped(mounted, `${where} ${label} before`);
          edit(mounted, font, [paragraph(shaping, to)]);
          if (to.length > 0) assertShaped(mounted, `${where} ${label} after`);
          assertMatchesFreshBuild(font, mounted, [paragraph(shaping, to)], `${where} ${label}`);
        } finally {
          unmount(mounted);
        }
      });

      test(`${where}: ${label}, across a styled multi-node group`, { timeout }, async () => {
        const font = await fonts.load(fixture);
        const [head, tail] = shaping.anchors;
        const before = styledScene(shaping, [head, from, tail]);
        const edited = styledScene(shaping, [head, to, tail]);
        const mounted = mount(font, before);
        try {
          edit(mounted, font, edited);
          assertMatchesFreshBuild(font, mounted, edited, `${where} styled group ${label}`);
        } finally {
          unmount(mounted);
        }
      });

      test(`${where}: ${label}, reverted and reapplied on a clipped single line`, { timeout }, async () => {
        // Round-tripping is the cheapest way to reach a slot whose occupant left and came back, and
        // a clipped single line drops the glyphs past the box, so the record run also grows and
        // shrinks under the edit rather than only shifting.
        const font = await fonts.load(fixture);
        const authored = (text) => [paragraph(shaping, text, { flow: clippedFlow })];
        const mounted = mount(font, authored(from));
        try {
          for (const [step, text] of [to, from, to, from, to].entries()) {
            edit(mounted, font, authored(text));
            assertMatchesFreshBuild(font, mounted, authored(text), `${where} ${label} round-trip step ${step}`);
          }
        } finally {
          unmount(mounted);
        }
      });
    }

    test(`${where}: seeded edit sequences at grapheme boundaries`, { timeout }, async () => {
      // What an editor actually produces: every splice lands on a grapheme boundary, so no cluster
      // is ever cut in half and the sequence stays representative of typing and selection.
      await runSequence(shaping, fixture, graphemeUnits(shaping.alphabet.join('')));
    });

    test(`${where}: seeded edit sequences at scalar boundaries`, { timeout }, async () => {
      // The harder half: splices land on any scalar boundary, so an edit can cut a conjunct, a
      // matra, or a ligature in half and change the cluster's glyph count without changing its
      // length. This is the shape that moves an occupant between record slots.
      await runSequence(shaping, fixture, shaping.alphabet);
    });
  }
}

async function runSequence(shaping, fixture, units) {
  const font = await fonts.load(fixture);
  for (const seed of [1, 7, 13, 29]) {
    const random = seededRandom(seed);
    let texts = [shaping.seed, shaping.anchors[0], shaping.anchors[1]];
    const mounted = mount(font, styledScene(shaping, texts));
    try {
      for (let step = 0; step < 10; step += 1) {
        texts = texts.map((text) => spliceEdit(text, units, random));
        const authored = styledScene(shaping, texts);
        edit(mounted, font, authored);
        assertMatchesFreshBuild(
          font,
          mounted,
          authored,
          `${shaping.id} on ${fixture} seed ${seed} step ${step} -> ${JSON.stringify(texts)}`,
        );
      }
    } finally {
      unmount(mounted);
    }
  }
}

/** Splice a random range and insert a random run, so deletions, insertions, and replacements mix. */
function spliceEdit(text, units, random) {
  const offsets = boundaryOffsets(text, units);
  const start = offsets[Math.floor(random() * offsets.length)];
  const reachable = offsets.filter((offset) => offset >= start);
  const end = reachable[Math.floor(random() * reachable.length)];
  let insert = '';
  for (let index = Math.floor(random() * 4); index > 0; index -= 1) {
    insert += units[Math.floor(random() * units.length)];
  }
  const next = text.slice(0, start) + insert + text.slice(end);
  // An edit that changes nothing exercises no path; nudge it into one that does.
  return admissible(next === text ? text.slice(0, Math.max(0, text.length - 1)) : next);
}

/**
 * Trim a generated string down to one the engine will accept.
 *
 * EXCLUDED, and pinned separately: text where UAX #14 offers a line-break opportunity strictly
 * inside a UAX #29 grapheme cluster -- a SPACE followed by a combining mark is the reachable case,
 * because LB9 does not attach a mark to a preceding SPACE while GB9 does. The engine rejects that
 * whole frame rather than ignoring the opportunity, which
 * `text-mutation-known-defects.test.mjs` case 3 reproduces minimally. Splicing at scalar boundaries
 * generates it constantly, and letting it through would leave these sequences reporting a defect
 * they are not for instead of testing the packed lanes they are for.
 */
function admissible(text) {
  for (let candidate = text; candidate.length > 0; candidate = candidate.slice(0, -1)) {
    const clusters = [...findGraphemeBoundaries(candidate)];
    const interior = findLineBreaks(candidate)
      .map((entry) => entry.position)
      .some((position) => position > 0 && position < candidate.length && !clusters.includes(position));
    if (!interior) return candidate;
  }
  return '';
}

/**
 * The offsets a splice may land on.
 *
 * Scalar sequences use every scalar boundary, so a cluster can be cut. Grapheme sequences use only
 * grapheme boundaries, so it cannot. A surrogate pair is never split either way: scalar boundaries
 * are taken from the string's own code-point iterator, not from its code-unit indices.
 */
function boundaryOffsets(text, units) {
  const graphemes = units.some((unit) => [...unit].length > 1 || unit.length > 1);
  if (!graphemes) return [...scalarOffsets(text)];
  return [...findGraphemeBoundaries(text)];
}

function* scalarOffsets(text) {
  let offset = 0;
  for (const scalar of text) {
    yield offset;
    offset += scalar.length;
  }
  yield offset;
}

function graphemeUnits(source) {
  return [...GRAPHEMES.segment(source)].map((entry) => entry.segment);
}

/**
 * The oracle's negative control.
 *
 * Everything above is an assertion that two scenes agree. If `assertMatchesFreshBuild` could not
 * SEE a difference, every one of those assertions would pass on a corrupt buffer and this whole
 * file would be decorative. Corrupting one float in one packed lane -- the smallest defect the
 * mechanism under test can produce -- must make it fail, per lane, so no lane is silently exempt.
 */
test('the differential oracle fails when a single packed float is corrupted', { timeout }, async () => {
  const shaping = CASES.find((entry) => entry.id === 'indic-reordering');
  const font = await fonts.load('devanagari');
  const authored = (text) => [paragraph(shaping, text, { styled: true })];
  const mounted = mount(font, authored('कर्म क्षेत्र'));
  try {
    edit(mounted, font, authored('कर्म में क्षेत्र'));
    assertMatchesFreshBuild(font, mounted, authored('कर्म में क्षेत्र'), 'control baseline');

    const drawn = lanes(mounted).draws;
    assert.ok(drawn.length > 0, 'the control needs at least one draw to corrupt');
    const packed = Object.keys(drawn[0].attributes).sort();
    assert.ok(packed.length > 0, 'the control needs at least one packed instanced lane to corrupt');

    for (const name of packed) {
      const attribute = attributeNamed(mounted, name);
      const slot = drawn[0].start * (attribute.itemSize ?? 1);
      const original = attribute.array[slot];
      // A value no legal packing of this paragraph can produce, so a pass cannot be a coincidence.
      attribute.array[slot] = original === 0 ? 12_345 : 0;
      try {
        assert.throws(
          () => assertMatchesFreshBuild(font, mounted, authored('कर्म में क्षेत्र'), 'control'),
          (error) => error instanceof assert.AssertionError && error.message.includes(name),
          `corrupting ${name} must be reported against ${name}`,
        );
      } finally {
        attribute.array[slot] = original;
      }
    }

    // And the restored scene must agree again, so the control proved detection rather than damage.
    assertMatchesFreshBuild(font, mounted, authored('कर्म में क्षेत्र'), 'control restored');
    assert.ok(packed.includes(IDENTITY_LANE), 'the identity lane must be among the lanes the control covers');
  } finally {
    unmount(mounted);
  }
});

function attributeNamed(mounted, name) {
  let found;
  mounted.group.traverse((object) => {
    if (found !== undefined || object.userData.pmndrsGlyphRunStart === undefined) return;
    found = object.geometry?.attributes?.[name];
  });
  assert.notEqual(found, undefined, `no draw exposed a ${name} attribute`);
  return found;
}
