import type { GlyphLayout } from '../layout.js';
import type { JsonValue } from '../raster.js';
import { normalizeRasterCoverage, RasterCoverageError, type RasterCoverage } from '../raster-coverage.js';
import { canonicalJson } from './raster-identity.js';

export interface DecodedRasterCoverage {
  readonly descriptor: RasterCoverage;
  readonly bits: Uint8Array;
}

export function decodeRasterCoverage(
  extension: Readonly<Record<string, JsonValue>>,
  glyphCount: number,
  view: (index: number) => Uint8Array,
  label: string,
): DecodedRasterCoverage | undefined {
  const hasDescriptor = extension.coverage !== undefined;
  const hasView = extension.coverageBufferView !== undefined;
  if (hasDescriptor !== hasView) {
    throw new TypeError(`${label} coverage descriptor and coverageBufferView must appear together`);
  }
  if (!hasDescriptor) return undefined;

  const descriptor = normalizeRasterCoverage(extension.coverage)!;
  if (canonicalJson(extension.coverage!) !== canonicalJson(descriptor)) {
    throw new TypeError(`${label} coverage descriptor is not canonical`);
  }
  const viewIndex = extension.coverageBufferView;
  if (typeof viewIndex !== 'number' || !Number.isSafeInteger(viewIndex) || viewIndex < 0) {
    throw new TypeError(`${label} coverageBufferView must be a nonnegative integer`);
  }
  const bits = view(viewIndex);
  if (bits.byteLength !== Math.ceil(glyphCount / 8)) {
    throw new TypeError(`${label} coverage bitset does not match the registered glyph count`);
  }
  const usedBits = glyphCount % 8;
  if (usedBits !== 0 && (bits.at(-1)! & ~((1 << usedBits) - 1)) !== 0) {
    throw new TypeError(`${label} coverage padding bits must be zero`);
  }
  if (!bits.some((byte) => byte !== 0)) {
    throw new TypeError(`${label} coverage must select at least one glyph`);
  }
  return Object.freeze({ descriptor, bits });
}

export function assertRasterCoverage(
  layout: GlyphLayout,
  fontSlot: number,
  coverage: Uint8Array | undefined,
  rasterKind: string,
): void {
  if (coverage === undefined) return;
  const missing = new Set<number>();
  for (let index = 0; index < layout.glyphIds.length; index += 1) {
    if (layout.glyphFontSlots[index] !== fontSlot) continue;
    const glyphId = layout.glyphIds[index]!;
    if ((coverage[glyphId >> 3]! & (1 << (glyphId & 7))) === 0) missing.add(glyphId);
  }
  if (missing.size !== 0)
    throw new RasterCoverageError(
      rasterKind,
      [...missing].sort((left, right) => left - right),
    );
}
