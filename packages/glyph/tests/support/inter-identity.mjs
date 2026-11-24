import { readFile } from 'node:fs/promises';

import { createFontBaker, fontBakerWasmUrl } from '@pmndrs/glyph/bake';

import golden from '../fixtures/inter-bitmap-v0.json' with { type: 'json' };

export const interSourceFingerprint = golden.source.fingerprint;
export const interShapingFingerprint = golden.source.shapingFingerprint;

const interUrl = new URL('../../../../benches/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url);
let prepared;

/**
 * Inter as every bake prepares it (every code point, the common layout features), the source the golden identities
 * describe, with the dropped features the core bake records.
 */
export function readInterPrepared() {
  prepared ??= Promise.all([readFile(interUrl), readFile(new URL(fontBakerWasmUrl))]).then(async ([source, wasm]) => {
    const baker = await createFontBaker(wasm);
    const result = baker.prepare({
      source,
      selection: { formatVersion: 0, fontFaceIndex: 0, unicodeRanges: [{ start: 0, end: 0x10ffff }] },
    });
    return { source: result.bytes, droppedLayoutFeatures: result.report.droppedLayoutFeatures };
  });
  return prepared;
}
