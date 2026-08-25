import { Text, useFont } from '@pmndrs/glyph/react';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { useThree } from '@react-three/fiber/webgpu';
import { useMemo, useRef } from 'react';

/** The strike the chorus renders at; must match site/scripts/bake-chorus.mts. */
const STRIKE = 32;

import { CHORUS_URLS } from './chorus-stack';
import { RTL_WORDS, WORDS } from './chorus-words';
import { live } from './controls';

/**
 * One continuous stream, long enough to overflow three full-height columns at
 * any viewport. There are no line breaks in it: the engine decides every break,
 * fills each column to its bounded height, and carries the remainder into the
 * next.
 *
 * Drawn at random rather than cycled. A round-robin through the word list lays
 * the same languages down the same relative positions on every line, which the
 * eye reads as a pattern rather than as text. Seeded so the field is identical
 * on every load — the layout has to be stable to be judged, and a page that
 * reshuffles itself on refresh cannot be art-directed.
 */
const STREAM_WORDS = 5_000;

const SEED = 0x9e3779b9;

/** mulberry32 — small, fast, and good enough for scattering words. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let drawn = Math.imul(state ^ (state >>> 15), 1 | state);
    drawn = (drawn + Math.imul(drawn ^ (drawn >>> 7), 61 | drawn)) ^ drawn;
    return ((drawn ^ (drawn >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const LTR = WORDS.filter((word) => !RTL_WORDS.has(word));
const RTL = WORDS.filter((word) => RTL_WORDS.has(word));

function stream(rtlShare: number, count: number): string {
  const next = random(SEED);
  const words: string[] = [];
  let previous = '';
  for (let index = 0; index < count; index += 1) {
    const pool = next() < rtlShare ? RTL : LTR;
    // Never twice in a row: a repeat reads as a mistake rather than a shuffle.
    let pick = previous;
    while (pick === previous) pick = pool[Math.floor(next() * pool.length)]!;
    previous = pick;
    words.push(pick);
  }
  return words.join(' ');
}

/** Rebuilt only when the mix changes, which is a panel action rather than a frame. */
const cache = new Map<string, string>();
function chorusFor(rtlShare: number, count: number): string {
  const key = `${Math.round(rtlShare * 100) / 100}:${count}`;
  let text = cache.get(key);
  if (text === undefined) {
    text = stream(Math.round(rtlShare * 100) / 100, count);
    cache.set(key, text);
  }
  return text;
}

/**
 * Column count by width, in CSS pixels.
 *
 * Three columns stop being columns and start being slivers well before a phone.
 * A justified line needs enough words on it that the spaces can absorb the
 * remainder; a narrow column with long words justifies into gap-toothed
 * nonsense. Two holds down to tablet width, one from there.
 */
function columnsFor(width: number): number {
  if (width < 560) return 1;
  if (width < 940) return 2;
  return 3;
}

// Bitmap, not MSDF: the chorus is small body copy at a fixed size, which is
// exactly what a native strike is for. MSDF bakes a full-size atlas per face
// regardless of glyph count, and twenty-one of those cost 448 MB of texture for
// a few hundred glyphs.
const REQUESTS = CHORUS_URLS.map(
  (url) => ({ input: { baked: url }, raster: { technique: bitmap, options: { strikes: [STRIKE] } } }) as const,
);

for (const request of REQUESTS) useFont.preload(request);

/**
 * The editorial field the wordmark sits over.
 *
 * One paragraph and one ordered font stack: the engine resolves each script to
 * the face that covers it, so the fallback is the library's own rather than the
 * application choosing a font per word.
 */
export function Chorus() {
  // The request list is a module constant emitted by the bake script, so its
  // length never changes at runtime and hook order is stable.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const fonts = REQUESTS.map((request) => useFont(request));

  const field = useRef<ThreeText<typeof bitmap>>(null);

  // A hole in a line of justified text is either a stretched space or a word
  // that failed to shape. The engine knows which, so ask it rather than guess.
  const reported = useRef(false);
  useFrame(() => {
    if (reported.current) return;
    const summary = field.current?.measureLayout();
    if (!summary || summary.glyphCount === 0) return;
    reported.current = true;
    if (import.meta.env.DEV) {
      console.info('[chorus]', {
        glyphCount: summary.glyphCount,
        lineCount: summary.lineCount,
        missingGlyphCount: summary.missingGlyphCount,
        overflowed: summary.overflowed,
      });
    }
  });

  const size = useThree((state) => state.size);
  const viewport = useThree((state) => state.viewport);

  const stack = useMemo(() => ({ fonts: fonts as unknown as readonly [(typeof fonts)[0], ...typeof fonts] }), [fonts]);

  // The field sits behind the mark, so the frustum has opened up by the time it
  // reaches that depth and the box has to grow to match.
  const depth = live.chorusDepth;
  const spread = 1 + depth / 6;
  const width = viewport.width * spread * 1.08;
  const height = viewport.height * spread * 1.2;
  const fontSize = width * live.chorusSize;

  return (
    <Text
      contentBox={{
        // Flush columns and exactly-one-space cannot both be had: justification
        // pays for a flush edge with variable word spaces. At roughly
        // twenty-five characters per line — well under the thirty-five a
        // newspaper insists on — the deficit has too few spaces to hide in, so
        // ragged is the honest default and flush is a toggle.
        align: live.chorusJustify > 0.5 ? 'justify' : 'start',
        // The gap is specified in screen pixels and converted, so a column
        // never closes up to a hairline just because the field sits deeper or
        // the viewport got narrow.
        columns: {
          count: columnsFor(size.width),
          gap: Math.max(fontSize * 0.9, (live.chorusGap * width) / Math.max(size.width, 1)),
        },
        // Columns fill top to bottom and then move across, so the engine needs a
        // bounded height to know where one column ends.
        height: { mode: 'exact', size: height },
        // Elastic both ways, with the remainder spilling into letter spacing
        // rather than into the word gaps. Growth alone is what produces rivers:
        // a line that can only stretch has to open every space to reach flush,
        // where one that can also shrink usually absorbs the deficit invisibly.
        justify: {
          letterSpaceExpansion: live.chorusLetter,
          maxWordSpaceRatio: live.chorusMaxSpace,
          minWordSpaceRatio: live.chorusMinSpace,
        },
        // Only the final line of the whole flow is short, so leaving it ragged
        // is correct rather than stretching it across the column.
        lastLine: 'auto',
        overflow: 'clip',
        width: { mode: 'exact', size: width },
        wrap: 'word',
      }}
      font={stack}
      ref={field}
      // Set back by value, not only by depth: the field has to read as ground
      // for the mark, and at full strength it competes with it.
      paint={{ color: '#8fa3c4', opacity: live.chorusDim }}
      position={[-width / 2, height / 2, -depth]}
      style={{ fontSize, lineHeight: live.chorusLeading }}
    >
      {chorusFor(live.chorusRtl, live.chorusWords)}
    </Text>
  );
}
