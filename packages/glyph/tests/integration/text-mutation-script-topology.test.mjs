/** Extends `text-mutation-gpu-lanes.test.mjs`'s differential/packed-lane oracle to scripts where slot reassignment (bidi reorder, ligature absorption, cluster reordering, conjunct formation) can desync the engine's identity-space change mask from the gather's slot-space read. Seeded and deterministic. */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';

import { bitmap } from '@pmndrs/glyph/raster/bitmap';
import { slug } from '@pmndrs/glyph/raster/slug';

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
import { findLineBreaks } from '../support/unicode-line-breaks.mjs';

// The package-pinned preflight segmentation. `Intl.Segmenter` follows host ICU and can disagree on
// degenerate sequences, so it cannot be the oracle for the span compiler's deterministic behavior.
import { findGraphemeBoundaries } from '../../dist/internal/graphemes.js';

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const bitmap16 = bitmap({ strikes: [16] });

const FIXTURES = {
  'amiri-bitmap': { file: 'amiri-bitmap-16.font.glb', raster: bitmap16 },
  'amiri-slug': { file: 'amiri-slug.font.glb.gz', raster: slug },
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

/** Style carries the case's direction/language/features (a topology case means nothing under the wrong ones); features are dropped for empty text since the engine rejects a feature range over an empty paragraph. Spans derive from the text so an edited and freshly built node share identical authored style. */
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

/** Boundaries snap outward to grapheme boundaries because the engine rejects any frame whose span splits a cluster (`cluster_state.rs`, `build`); unlike Latin, these scripts rarely land a code-unit third on one already. A boundary inside a ligature is left unsnapped on purpose — the run just splits. */
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

/** `alphabet` is the pool a seeded splice may draw from; every entry comes from the same authored corpus as the case's edits, so a randomized sequence can't wander outside the baked fixture and turn this into a `.notdef` assertion. */
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

/** Distinct position/size/color per node means every packed lane carries an identifying value, so slot corruption can't read back correct by accident. The edit lands on the middle node, so surrounding nodes must keep their lanes while the record run under them shifts. */
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

/** Excludes text where a UAX #14 break point falls inside a UAX #29 cluster (space + combining mark, LB9 vs GB9) — that's `text-mutation-known-defects.test.mjs` case 3's defect, not this file's, and scalar splicing generates it constantly. */
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

/** Scalar sequences use every scalar boundary (so a cluster can be cut); grapheme sequences use only grapheme boundaries. Either way a surrogate pair is never split, since scalar boundaries come from the code-point iterator. */
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

/** Negative control: proves `assertMatchesFreshBuild` can see a difference. Without this, every assertion above could pass against a corrupt buffer. Corrupting one float in one packed lane must fail, per lane. */
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
  mounted.scene.traverse((object) => {
    if (found !== undefined || object.userData.pmndrsGlyphRunStart === undefined) return;
    found = object.geometry?.attributes?.[name];
  });
  assert.notEqual(found, undefined, `no draw exposed a ${name} attribute`);
  return found;
}
