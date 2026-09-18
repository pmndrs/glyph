/**
 * The replay signal. The title's landing starts the typing after the lift and slam. Listeners
 * clear on this the moment the input arrives, then wait for the impact to time themselves against.
 */
let count = 0;

export function requestReplay(): void {
  count += 1;
}

export function replayCount(): number {
  return count;
}
