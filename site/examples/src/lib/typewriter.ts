/**
 * A typewriter over public-domain passages: type at `TYPE_RATE`, hold, erase
 * fast, move to the next. Pure functions of elapsed time, so any scene can
 * agree on the same moment.
 */
export const PASSAGES = [
  // Emily Dickinson, 1861
  'Hope is the thing with feathers that perches in the soul, and sings the tune without the words, and never stops at all.',
  // Walt Whitman, 1855
  'I celebrate myself, and sing myself, and what I assume you shall assume, for every atom belonging to me as good belongs to you.',
] as const;

const TYPE_RATE = 12;
const ERASE_RATE = 60;
const HOLD = 3;

/** A passage by index; the index always comes from `passageFrame`, which stays in range. */
export function passageAt(index: number): string {
  return PASSAGES[index] ?? PASSAGES[0];
}

/** Where the typewriter is at a moment: which passage, how many characters, forward or back. */
export function passageFrame(elapsed: number): { passage: number; shown: number } {
  let t = elapsed;
  for (let cycle = 0; ; cycle += 1) {
    const index = cycle % PASSAGES.length;
    const passage = passageAt(index);
    const typing = passage.length / TYPE_RATE;
    const erasing = passage.length / ERASE_RATE;
    const total = typing + HOLD + erasing + 0.6;
    if (t < total) {
      if (t < typing) return { passage: index, shown: Math.floor(t * TYPE_RATE) };
      if (t < typing + HOLD) return { passage: index, shown: passage.length };
      if (t < typing + HOLD + erasing)
        return { passage: index, shown: passage.length - Math.floor((t - typing - HOLD) * ERASE_RATE) };
      return { passage: index, shown: 0 };
    }
    t -= total;
  }
}

/** Split typed text into everything before the current word and the word itself. */
export function splitCurrentWord(typed: string): { before: string; current: string } {
  const at = typed.lastIndexOf(' ') + 1;
  return { before: typed.slice(0, at), current: typed.slice(at) };
}

/** The last complete word of a string, so a display keeps a word while a space is being typed. */
export function lastWord(text: string): string {
  const words = text.trim().split(' ');
  return words[words.length - 1] ?? '';
}

export interface TypistRates {
  readonly typeRate: number;
  readonly eraseRate: number;
  readonly hold: number;
}

/**
 * The same clock over any list of lines: which line, how many characters
 * shown. `passageFrame` is this with the passages and their rates.
 */
export function typistFrame(
  lines: readonly string[],
  elapsed: number,
  { typeRate, eraseRate, hold }: TypistRates,
): { line: number; shown: number } {
  let t = elapsed;
  for (let cycle = 0; ; cycle += 1) {
    const index = cycle % lines.length;
    const line = lines[index] ?? '';
    const typing = line.length / typeRate;
    const erasing = line.length / eraseRate;
    const total = typing + hold + erasing + 0.5;
    if (t < total) {
      if (t < typing) return { line: index, shown: Math.floor(t * typeRate) };
      if (t < typing + hold) return { line: index, shown: line.length };
      if (t < typing + hold + erasing)
        return { line: index, shown: line.length - Math.floor((t - typing - hold) * eraseRate) };
      return { line: index, shown: 0 };
    }
    t -= total;
  }
}
