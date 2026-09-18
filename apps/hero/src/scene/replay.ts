/**
 * The replay signal. The title's landing is what starts the typing, but that is a fifth of a second after the key or
 * the click — long enough for the finished line to sit there while the word is already flying back in. Listeners
 * clear on this the moment the input arrives, then wait for the impact to time themselves against.
 */
let count = 0;

export function requestReplay(): void {
  count += 1;
}

export function replayCount(): number {
  return count;
}
