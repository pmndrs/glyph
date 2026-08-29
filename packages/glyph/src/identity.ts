import { fingerprint128, fingerprintDomain } from './internal/fingerprint.js';

declare const brand: unique symbol;

type Brand<Value, Name extends string> = Value & {
  readonly [brand]: Name;
};

export type FontHandle = Brand<number, 'FontHandle'>;
export type RasterHandle = Brand<number, 'RasterHandle'>;
export type FontKey = Brand<string, 'FontKey'>;
export type RasterKey = Brand<string, 'RasterKey'>;
export type Fingerprint = Brand<string, 'Fingerprint'>;

export const fingerprint: Readonly<{
  /** Calculate the bake-time fingerprint for one complete emitted artifact. */
  artifact(bytes: Uint8Array): Fingerprint;
  /** Calculate the source fingerprint supplied to raster bakers. */
  source(bytes: Uint8Array): Fingerprint;
}> = Object.freeze({
  artifact(bytes) {
    return fingerprint128(bytes, fingerprintDomain.artifact);
  },
  source(bytes) {
    return fingerprint128(bytes, fingerprintDomain.source);
  },
});

export type LocalGlyphId = number;
export type FontSlot = number;
