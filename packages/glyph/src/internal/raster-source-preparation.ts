import { createFontBaker } from '../font-baker/index.js';
import type { Fingerprint } from '../identity.js';
import { fingerprint128, fingerprintDomain } from './content-digest.js';
import { loadDecoderModule } from './glyph-outline-decoder.js';

const EVERY_CODE_POINT = [{ start: 0, end: 0x10ffff }] as const;

/**
 * Prepares a runtime-baked font's original source the way its bake did, so a raster generated later sees the bytes its
 * identity names. Only a bake of every code point keeps the original source (a Unicode subset does not), and its
 * preparation is fixed by the features it dropped: every feature except those reproduces the kept set. Returns
 * `undefined` when the result does not carry the expected fingerprint.
 */
export async function prepareRasterSource(
  source: Uint8Array,
  fontFaceIndex: number,
  droppedLayoutFeatures: Iterable<string>,
  expected: Fingerprint,
): Promise<Uint8Array | undefined> {
  const baker = await createFontBaker(await loadDecoderModule());
  const prepared = baker.prepare({
    source,
    selection: {
      formatVersion: 0,
      fontFaceIndex,
      unicodeRanges: EVERY_CODE_POINT,
      layoutFeatures: ['*', ...[...droppedLayoutFeatures].sort().map((tag) => `-${tag}`)],
    },
  });
  return fingerprint128(prepared.bytes, fingerprintDomain.source) === expected ? prepared.bytes : undefined;
}
