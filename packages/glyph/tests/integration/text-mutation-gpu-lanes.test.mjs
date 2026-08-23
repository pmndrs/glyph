/**
 * Incremental text mutation, verified through to the GPU.
 *
 * Every lane this engine already tested -- `measure`, `layout`, glyph ids, glyph
 * origins, draw counts, `instanceCount` -- reads the ENGINE. The packed instanced attributes are
 * what the GPU actually samples, and nothing asserted them. An incremental edit that leaves one
 * record slot holding its pre-edit occupant therefore passes every engine-side check while
 * rendering the wrong glyph, which is exactly the defect this file exists to catch.
 *
 * This file owns the Latin corpus and the three raster techniques. The differential oracle it
 * asserts lives in `../support/text-mutation-lanes.mjs`, shared with the script-topology and span
 * files so the invariant cannot drift between them.
 *
 * Sequences are seeded and fixed. A failure names the case and step that reproduce it, with no
 * wall-clock input and no `Math.random`.
 *
 * NOT COVERED: the stable-indirect allocation policy. `ThreeTextEngineCoordinator` registers the
 * Three policy with `threeRenderPolicyBytes`'s default `'ordered'` allocation mode and
 * `ThreeTextEngineCoordinatorOptions` exposes only `transformMode`, so no first-party path
 * reachable from `Text`/`TextGroup` selects `'stable'`. Covering it needs either a coordinator
 * option or a host-level test that drives `TextEngineHost` directly, as
 * `three-engine-runtime.test.mjs` does.
 */
import test, { after } from 'node:test';

import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { msdf } from '@pmndrs/glyph/three/msdf';
import { slug } from '@pmndrs/glyph/three/slug';

import {
  assertMatchesFreshBuild,
  createFontCache,
  edit,
  mount,
  seededRandom,
  timeout,
  unmount,
} from '../support/text-mutation-lanes.mjs';

/** The product-shaped box from the reported regression: centered, single line, clipped. */
const contentBox = {
  align: 'center',
  maxLines: 1,
  overflow: 'clip',
  width: { mode: 'exact', size: 96 },
  wrap: 'none',
};
/** Wide enough that mixed span sizes stay inside the line instead of clipping into it. */
const wideContentBox = { ...contentBox, width: { mode: 'exact', size: 320 } };
const style = { fontSize: 6, lineHeight: 1 };
const paint = { color: '#ffffff' };

const TECHNIQUES = {
  bitmap: { file: 'inter-bitmap-16.font.glb', raster: { technique: bitmap, options: { strikes: [16] } } },
  msdf: { file: 'inter-mtsdf.font.glb.gz', raster: { technique: msdf } },
  slug: { file: 'inter-slug.font.glb.gz', raster: { technique: slug } },
};

const fonts = createFontCache(TECHNIQUES);
after(() => fonts.dispose());

/**
 * Author one paragraph's content.
 *
 * Spans are derived from the text rather than fixed, so an edited node and a node freshly built
 * with the same text always carry identical authored style -- the comparison stays a test of the
 * incremental path, not of two different documents.
 */
function paragraph(text, { box = contentBox, position, rasterPixelRatio, styled = false } = {}) {
  return {
    position,
    properties: {
      contentBox: box,
      paint,
      spans: styled ? spansFor(text) : [],
      style,
      text,
      ...(rasterPixelRatio === undefined ? {} : { rasterPixelRatio }),
    },
  };
}

/** Two leading runs in different colours and sizes; the remainder keeps the paragraph defaults. */
function spansFor(text) {
  if (text.length < 3) return [];
  const third = Math.floor(text.length / 3);
  return [
    { start: 0, end: third, paint: { color: '#ff2f00' }, style: { fontSize: 9, lineHeight: 1 } },
    { start: third, end: third * 2, paint: { color: '#0040ff' }, style: { fontSize: 4, lineHeight: 1 } },
  ];
}

/** Every edit class the incremental path distinguishes, each as (from, to). */
const EDIT_CLASSES = [
  ['deletion between a shared prefix and suffix', 'ACTIVATE', 'ACTIVE'],
  ['deletion of an interior span', 'ABXYZC', 'ABC'],
  ['suffix-only deletion', 'RUNNING', 'RUN'],
  ['prefix-only deletion', 'PREFIXED', 'FIXED'],
  ['insertion between a shared prefix and suffix', 'ACTIVE', 'ACTIVATE'],
  ['insertion at the suffix', 'RUN', 'RUNNING'],
  ['insertion at the prefix', 'FIXED', 'PREFIXED'],
  ['same-length substitution', 'ACTIVE', 'ARCHER'],
  ['shrink to empty', 'ACTIVE', ''],
  ['grow from empty', '', 'ACTIVE'],
  ['single character to single character', 'A', 'E'],
  ['collapse to one character', 'ACTIVATE', 'A'],
];

/**
 * A three-node group with per-span colours and sizes and per-node raster pixel ratios.
 *
 * One paragraph in uniform white at one size leaves the foreground, `fontSize`, and
 * `transformIndex` lanes constant, so a slot corrupted in exactly those lanes reads back correct
 * by accident. Distinct positions, sizes, and colours make each of those lanes carry a value that
 * identifies its own slot.
 *
 * `rasterPixelRatio` is not itself a packed lane -- no first-party program in `render-policy.ts`
 * reads it -- but it is one of the two resource-selection inputs, so varying it per node drives
 * the gather's selection-change branch, the one that widens a narrow change mask to every input.
 * It cannot select a DIFFERENT resource here: these fixtures bake one strike and one page each,
 * and requesting more strikes needs retained source bytes the fixtures do not carry.
 */
function styledScene(texts) {
  return texts.map((text, index) =>
    paragraph(text, {
      box: wideContentBox,
      position: [index * 24, index * -12, index * 3],
      rasterPixelRatio: 1 + index,
      styled: true,
    }),
  );
}

for (const technique of Object.keys(TECHNIQUES)) {
  for (const [label, from, to] of EDIT_CLASSES) {
    test(`${technique}: ${label}`, { timeout }, async () => {
      const font = await fonts.load(technique);
      const mounted = mount(font, [paragraph(from)]);
      try {
        edit(mounted, font, [paragraph(to)]);
        assertMatchesFreshBuild(font, mounted, [paragraph(to)], `${technique} ${from}->${to}`);
      } finally {
        unmount(mounted);
      }
    });

    test(`${technique}: ${label} across a styled multi-node group`, { timeout }, async () => {
      const font = await fonts.load(technique);
      // The edit lands on the middle node, so the nodes around it must keep their own transform,
      // colour, and size lanes while the record run under them shifts.
      const before = styledScene(['STEADY', from, 'ANCHOR']);
      const edited = styledScene(['STEADY', to, 'ANCHOR']);
      const mounted = mount(font, before);
      try {
        edit(mounted, font, edited);
        assertMatchesFreshBuild(font, mounted, edited, `${technique} styled group ${from}->${to}`);
      } finally {
        unmount(mounted);
      }
    });
  }

  test(`${technique}: repeated edits without remounting`, { timeout }, async () => {
    const font = await fonts.load(technique);
    const mounted = mount(font, [paragraph('ACTIVATE')]);
    try {
      for (const [step, text] of ['ACTIVE', 'ACTIVATE', 'ACTIVE', 'ACTIVATE', 'ACTIVE'].entries()) {
        edit(mounted, font, [paragraph(text)]);
        assertMatchesFreshBuild(font, mounted, [paragraph(text)], `${technique} toggle step ${step} -> ${text}`);
      }
    } finally {
      unmount(mounted);
    }
  });

  test(`${technique}: seeded chaotic edit sequences`, { timeout }, async () => {
    const font = await fonts.load(technique);
    // A small alphabet with real kern pairs and repeated letters, so edits land on shared
    // prefixes and suffixes far more often than random text would.
    const alphabet = 'ACEIRTVX';
    for (const seed of [1, 7, 13, 29]) {
      const random = seededRandom(seed);
      // Every seed drives a styled three-node group, so a chaotic edit has to keep the untouched
      // nodes' colour, size, transform, and ratio lanes intact as well as its own.
      let texts = ['ACTIVATE', 'ACTIVATE', 'ACTIVATE'];
      const mounted = mount(font, styledScene(texts));
      try {
        for (let step = 0; step < 12; step += 1) {
          texts = texts.map((text) => chaoticEdit(text, alphabet, random));
          const authored = styledScene(texts);
          edit(mounted, font, authored);
          assertMatchesFreshBuild(
            font,
            mounted,
            authored,
            `${technique} seed ${seed} step ${step} -> ${JSON.stringify(texts)}`,
          );
        }
      } finally {
        unmount(mounted);
      }
    }
  });
}

/** Splice a random range and insert a random run, so deletions, insertions, and replacements mix. */
function chaoticEdit(text, alphabet, random) {
  const start = Math.floor(random() * (text.length + 1));
  const end = start + Math.floor(random() * Math.max(1, text.length - start + 1));
  const insertLength = Math.floor(random() * 4);
  let insert = '';
  for (let index = 0; index < insertLength; index += 1) {
    insert += alphabet[Math.floor(random() * alphabet.length)];
  }
  const next = text.slice(0, start) + insert + text.slice(Math.min(end, text.length));
  // An edit that changes nothing exercises no path; nudge it into one that does.
  return next === text ? text.slice(0, Math.max(0, text.length - 1)) : next;
}
