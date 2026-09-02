import { Rules } from '@cto.af/linebreak';

const rules = new Rules();

/** Test-fixture UAX #14 opportunities used to choose adversarial mutation boundaries. */
export function findLineBreaks(text) {
  const breaks = [];
  for (const entry of rules.breaks(text)) {
    breaks.push({ position: entry.position, required: entry.required });
  }
  return breaks;
}
