/**
 * The alphabet a split-flap wheel carries, in wheel order. A cell reaches a
 * letter by flipping forward through the wheel from where it is, never back.
 */
export const WHEEL = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:-';

export function wheelIndex(character: string): number {
  const index = WHEEL.indexOf(character.toUpperCase());
  return index === -1 ? 0 : index;
}

/** The character `steps` flips after `from` on the wheel. */
export function wheelAt(from: string, steps: number): string {
  return WHEEL[(wheelIndex(from) + steps) % WHEEL.length] ?? ' ';
}

/** Flips from one character forward to another, going around if it has to. */
export function flipsBetween(from: string, to: string): number {
  return (wheelIndex(to) - wheelIndex(from) + WHEEL.length) % WHEEL.length;
}

/** Pads or trims a line to the board's width. */
export function fit(line: string, columns: number): string {
  return line.toUpperCase().padEnd(columns).slice(0, columns);
}

/** The board's messages, one per row, cycling. */
export const BOARDS: readonly (readonly string[])[] = [
  [
    'AMSTERDAM   12:40 ON TIME',
    'REYKJAVIK   13:05 DELAYED',
    'LISBON      13:20 BOARDING',
    'KYOTO       14:10 ON TIME',
    'MONTEVIDEO  14:35 GATE 7',
    'TROMSO      15:00 CANCELLED',
  ],
  [
    'THE QUICK BROWN FOX      ',
    'JUMPS OVER THE LAZY DOG  ',
    'ONE DRAW FOR THE BOARD   ',
    'EVERY CELL IS A TEXT     ',
    'EVERY FLIP IS A SET      ',
    'MSDF INTER 0.42 UNITS    ',
  ],
  [
    'HOPE IS THE THING        ',
    'WITH FEATHERS THAT       ',
    'PERCHES IN THE SOUL      ',
    'AND SINGS THE TUNE       ',
    'WITHOUT THE WORDS        ',
    'AND NEVER STOPS AT ALL   ',
  ],
];
