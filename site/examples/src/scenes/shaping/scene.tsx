import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { useFrame } from '@react-three/fiber/webgpu';
import { useMemo, useState } from 'react';

import { CHORUS, CHORUS_MSDF, INTER } from '../../fonts';
import { PAPER, PAPER_DIM } from '../../theme';

/**
 * Eight scripts arriving one grapheme cluster at a time. Every arrival
 * reshapes the word: Devanagari and Bengali fold क + ् + ष into a conjunct,
 * Tamil hangs a vowel sign on ழ, Thai stacks a mark, Khmer subscripts a
 * consonant, Hebrew runs right to left, Hangul is already composed, and the
 * kanji simply are. The shaper is the same Rust in every row; only `language`
 * changes, and the face it has to draw with.
 */
export const ROWS = [
  { face: 'hebrew', word: 'אות', language: 'he', direction: 'rtl', note: 'Hebrew, right to left' },
  { face: 'devanagari', word: 'अक्षर', language: 'hi', direction: 'ltr', note: 'Devanagari conjunct' },
  { face: 'bengali', word: 'অক্ষর', language: 'bn', direction: 'ltr', note: 'Bengali conjunct' },
  { face: 'tamil', word: 'எழுத்து', language: 'ta', direction: 'ltr', note: 'Tamil vowel signs' },
  { face: 'thai', word: 'อักขระ', language: 'th', direction: 'ltr', note: 'Thai stacked mark' },
  { face: 'khmer', word: 'អក្សរ', language: 'km', direction: 'ltr', note: 'Khmer subscript consonant' },
  { face: 'korean', word: '글리프', language: 'ko', direction: 'ltr', note: 'Hangul composed syllables' },
  { face: 'japanese', word: '字形', language: 'ja', direction: 'ltr', note: 'Kanji' },
] as const;

const STEP = 0.32; // seconds per cluster
const HOLD = 2.5; // seconds the finished set rests before it starts over

export default function Shaping() {
  const inter = useMsdf(INTER);
  const faces = {
    hebrew: useMsdf(CHORUS.hebrew, CHORUS_MSDF),
    devanagari: useMsdf(CHORUS.devanagari, CHORUS_MSDF),
    bengali: useMsdf(CHORUS.bengali, CHORUS_MSDF),
    tamil: useMsdf(CHORUS.tamil, CHORUS_MSDF),
    thai: useMsdf(CHORUS.thai, CHORUS_MSDF),
    khmer: useMsdf(CHORUS.khmer, CHORUS_MSDF),
    korean: useMsdf(CHORUS.korean, CHORUS_MSDF),
    japanese: useMsdf(CHORUS.japanese, CHORUS_MSDF),
  };
  const clusters = useMemo(() => ROWS.map((row) => graphemes(row.word, row.language)), []);
  const total = clusters.reduce((sum, units) => sum + units.length, 0);
  const [revealed, setRevealed] = useState(0);

  useFrame(({ elapsed }) => {
    const cycle = total * STEP + HOLD;
    const next = Math.min(total, Math.floor((elapsed % cycle) / STEP) + 1);
    if (next !== revealed) setRevealed(next);
  });

  const shown = revealPlan(clusters, revealed);
  return (
    <>
      {ROWS.map((row, index) => {
        const units = clusters[index] ?? [];
        const column = index % 2;
        const line = Math.floor(index / 2);
        const x = -5 + column * 5.5;
        const y = 2.3 - line * 1.35;
        return (
          <group key={row.face} position={[x, y, 0]}>
            <Text
              font={faces[row.face]}
              style={{ fontSize: 0.72, color: PAPER, language: row.language, direction: row.direction }}
              layout={{ align: 'start', wrap: 'none' }}
              constraints={{ width: { mode: 'exact', size: 4.5 } }}
            >
              {units.slice(0, shown[index]).join('')}
            </Text>
            <Text
              font={inter}
              style={{ fontSize: 0.2, color: PAPER_DIM, letterSpacing: 0.02 }}
              layout={{ align: 'start', wrap: 'none' }}
              constraints={{ width: { mode: 'exact', size: 4.5 } }}
              position={[0, -0.86, 0]}
            >
              {row.note}
            </Text>
          </group>
        );
      })}
    </>
  );
}

/** How many clusters each row shows when `revealed` clusters have arrived in row order. */
export function revealPlan(rows: readonly (readonly string[])[], revealed: number): readonly number[] {
  let budget = revealed;
  return rows.map((units) => {
    const shown = Math.max(0, Math.min(units.length, budget));
    budget -= units.length;
    return shown;
  });
}

/** Grapheme clusters, the smallest unit a reader would call "a character". */
export function graphemes(word: string, language: string): readonly string[] {
  const segmenter = new Intl.Segmenter(language, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(word), ({ segment }) => segment);
}
