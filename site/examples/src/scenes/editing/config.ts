import { ACCENT } from '../../theme';

/** Basic Latin only: the checked-in Inter subset covers U+0020–007E. */
export const LINES = [
  'Status: online, 3 nodes, 0 errors',
  'Status: degraded, 2 nodes, 1 error',
  'Status: offline, 0 nodes, 4 errors',
] as const;
export const RATES = { typeRate: 14, eraseRate: 48, hold: 2.4 } as const;
export const FONT_SIZE = 0.62;
export const STATE_COLORS: Readonly<Record<string, string>> = {
  online: '#4ade80',
  degraded: ACCENT,
  offline: '#ff6b6b',
};

export interface Run {
  readonly text: string;
  readonly color: string | undefined;
}

/**
 * The runs of a partly typed line: the state word after "Status: " in its
 * state's colour, every number in the accent, everything else plain. A
 * half-typed state word already carries the colour of the word it will be.
 */
export function runsOf(typed: string): readonly Run[] {
  const runs: Run[] = [];
  let cursor = 0;
  const push = (end: number, color?: string) => {
    if (end <= cursor) return;
    runs.push({ text: typed.slice(cursor, end), color });
    cursor = end;
  };
  const state = /^Status: ([a-z]+)/.exec(typed);
  const word = state?.[1];
  if (word !== undefined) {
    const start = 'Status: '.length;
    push(start);
    const key = Object.keys(STATE_COLORS).find((candidate) => candidate.startsWith(word));
    push(start + word.length, key === undefined ? undefined : STATE_COLORS[key]);
  }
  for (const match of typed.matchAll(/\d+/g)) {
    const index = match.index ?? 0;
    if (index < cursor) continue;
    push(index);
    push(index + match[0].length, ACCENT);
  }
  push(typed.length);
  return runs;
}
