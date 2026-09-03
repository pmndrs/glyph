import { CHORUS } from '../../fonts';

/** The per-script "glyph" faces from the landing chorus; each carries only its word. */
export const ROWS = [
  { face: CHORUS.latin, word: 'glyph', note: 'Latin' },
  { face: CHORUS.hebrew, word: 'אות', note: 'Hebrew' },
  { face: CHORUS.devanagari, word: 'अक्षर', note: 'Devanagari' },
  { face: CHORUS.bengali, word: 'অক্ষর', note: 'Bengali' },
  { face: CHORUS.tamil, word: 'எழுத்து', note: 'Tamil' },
  { face: CHORUS.thai, word: 'อักขระ', note: 'Thai' },
  { face: CHORUS.khmer, word: 'អក្សរ', note: 'Khmer' },
  { face: CHORUS.korean, word: '글리프', note: 'Korean' },
  { face: CHORUS.japanese, word: '字形', note: 'Japanese' },
] as const;

export type Row = (typeof ROWS)[number];

/** Seconds per cycle; every cycle mounts the next face cold in one column and preloaded in the other. */
export const PERIOD = 3.2;
/** How long before a cycle turns the right column starts its preload. */
export const PRELOAD_LEAD = 1.4;

export function rowAt(index: number): Row {
  return ROWS[index % ROWS.length] ?? ROWS[0];
}

/** A different URL is a different face, so each cycle and each column loads its own. */
export function urlFor(row: Row, column: 'cold' | 'warm', index: number): string {
  return `${row.face}?${column}=${index}`;
}
