import { createFontStack } from '@pmndrs/glyph';
import { Text, TextGroup, useFont } from '@pmndrs/glyph/react';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { msdf } from '@pmndrs/glyph/three/msdf';
import { useThree } from '@react-three/fiber/webgpu';
import { useMemo, useRef } from 'react';

/** Must match site/scripts/bake-chorus.mts. */
const EM_SIZE = 32;
const PIXEL_RANGE = 6;

import { CHORUS_URLS } from './chorus-stack';
import { RTL_WORDS, WORDS } from './chorus-words';
import { live } from './look';

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

/**
 * Words in short same-script runs rather than shuffled one at a time.
 *
 * A paragraph binds a different atlas for every font run, so scattering
 * twenty-one faces word-by-word makes nearly every word its own draw — measured
 * at 2429 draw calls for one paragraph. Emitting a handful of words per script
 * before switching cuts the switches by the run length while still reading as
 * mixed, because the eye samples a line, not a word.
 */
function stream(rtlShare: number, count: number, runLength: number): string {
  const next = random(SEED);
  const words: string[] = [];
  let previous = '';

  while (words.length < count) {
    const pool = next() < rtlShare ? RTL : LTR;
    const script = scriptOf(pool[Math.floor(next() * pool.length)]!);
    const run = Math.max(1, Math.round(runLength * (0.5 + next())));
    const family = pool.filter((word) => scriptOf(word) === script);

    for (let index = 0; index < run && words.length < count; index += 1) {
      let pick = previous;
      // Never twice in a row: a repeat reads as a mistake rather than a shuffle.
      while (pick === previous && family.length > 1) pick = family[Math.floor(next() * family.length)]!;
      if (family.length === 1) pick = family[0]!;
      previous = pick;
      words.push(pick);
    }
  }
  // Word · word · word. The dot gives the eye a boundary it can trust when the
  // scripts on either side of it are ones it cannot read.
  return words.join(' \u00b7 ');
}

/** Which face will end up drawing this word, near enough to group by. */
function scriptOf(word: string): string {
  const point = word.codePointAt(0)!;
  if (point < 0x0370) return 'latin';
  if (point < 0x0400) return 'greek';
  if (point < 0x0590) return 'cyrillic';
  if (point < 0x0600) return 'hebrew';
  if (point < 0x0900) return 'arabic';
  if (point < 0x3000) return `indic-${(point >> 7).toString(16)}`;
  return 'cjk';
}

/** Rebuilt only when the mix changes, which is a panel action rather than a frame. */
const cache = new Map<string, string>();
function chorusFor(rtlShare: number, count: number, runLength: number): string {
  const share = Math.round(rtlShare * 100) / 100;
  const key = `${share}:${count}:${runLength}`;
  let text = cache.get(key);
  if (text === undefined) {
    text = stream(share, count, runLength);
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

// Slug: exact outlines rather than an atlas. MSDF bakes a full-size atlas per
// face regardless of glyph count — twenty-two of those came to 448 MB of
// texture for a few hundred glyphs — while Slug carries curve data, so the
// cost scales with the glyphs actually baked rather than with the face count.
// The options are part of the raster identity, so the runtime request has to
// name the same ones the artifact was baked with. Ask for the defaults against
// a 32-texel atlas and the loader finds no matching raster, falls back to
// generating one, and fails for want of the source bytes.
const REQUESTS = CHORUS_URLS.map(
  (url) =>
    ({
      input: url,
      raster: { options: { emSize: EM_SIZE, pixelRange: PIXEL_RANGE }, technique: msdf },
    }) as const,
);

for (const request of REQUESTS) {
  useFont.preload(request.input, request.raster.technique, request.raster.options);
}

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
  const fonts = REQUESTS.map((request) => useFont(request.input, request.raster.technique, request.raster.options));

  const field = useRef<ThreeText<typeof msdf>>(null);

  // A hole in a line of justified text is either a stretched space or a word
  // that failed to shape. The engine knows which, so ask it rather than guess.
  const reported = useRef(false);
  useFrame(() => {
    if (reported.current) return;
    const summary = field.current?.measure();
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

  const stack = useMemo(() => {
    const [primary, ...fallback] = fonts;
    if (primary === undefined) throw new Error('the chorus requires at least one font');
    return createFontStack(primary, ...fallback);
  }, fonts);

  // The field sits behind the mark, so the frustum has opened up by the time it
  // reaches that depth and the box has to grow to match.
  const depth = live.chorusDepth;
  const spread = 1 + depth / 6;
  const width = viewport.width * spread * 1.08;
  const height = viewport.height * spread * 1.2;

  const columns = columnsFor(size.width);
  const gap = (live.chorusGap * width) / Math.max(size.width, 1);

  const fontSize = width * live.chorusSize;

  if (import.meta.env.DEV) {
    const perCssPixel = width / Math.max(size.width, 1);
    (globalThis as unknown as { __geom: unknown }).__geom = {
      boxWidthWorld: +width.toFixed(2),
      columnWidthCss: +((width - gap * (columns - 1)) / columns / perCssPixel).toFixed(1),
      columns,
      fontSizeCss: +(fontSize / perCssPixel).toFixed(1),
      gapCss: +(gap / perCssPixel).toFixed(1),
      gapWorld: +gap.toFixed(3),
      screenWidthCss: size.width,
      spread: +spread.toFixed(3),
      viewportWorld: +viewport.width.toFixed(2),
    };
  }

  return (
    // `independent` lets Rust reorder compatible draws. The default is
    // `ordered`, which forbids it — correct for text that overlaps itself, and
    // needlessly strict here: these words never touch each other, so nothing
    // depends on the order they are composited in, and same-atlas runs scattered
    // through the paragraph can collapse into one draw.
    <TextGroup compositing="independent" renderOrder={-1}>
      <Text
        constraints={{
          height: { mode: 'exact', size: height },
          width: { mode: 'exact', size: width },
        }}
        layout={{
          // Flush columns and exactly-one-space cannot both be had: justification
          // pays for a flush edge with variable word spaces. At roughly
          // twenty-five characters per line — well under the thirty-five a
          // newspaper insists on — the deficit has too few spaces to hide in, so
          // ragged is the honest default and flush is a toggle.
          align: live.chorusJustify > 0.5 ? 'justify' : 'start',
          // The gap is specified in screen pixels and converted, so a column
          // never closes up to a hairline just because the field sits deeper or
          // the viewport got narrow.
          columns: { count: columns, gap },
          // Columns fill top to bottom and then move across, so the engine needs a
          // bounded height to know where one column ends.
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
          // 'word' cannot break inside a word, exactly as CSS cannot, so a word
          // wider than the column runs straight through the gap into the next
          // one. The benchmark's editorial workload never meets this because it
          // sets Latin ipsum in half-width columns; a third-width column of
          // Khmer, Lao and Tamil meets it constantly. 'character' is the
          // engine's own answer, and for a decorative field a mid-word break
          // costs nothing next to an overflow.
          wrap: live.chorusBreak > 0.5 ? 'character' : 'word',
        }}
        font={stack}
        ref={field}
        // Set back by value, not only by depth: the field has to read as ground
        // for the mark, and at full strength it competes with it.
        position={[-width / 2, height / 2, -depth]}
        style={{ color: '#8fa3c4', fontSize, lineHeight: live.chorusLeading, opacity: live.chorusDim }}
      >
        {chorusFor(live.chorusRtl, live.chorusWords, live.chorusRun)}
      </Text>
    </TextGroup>
  );
}
