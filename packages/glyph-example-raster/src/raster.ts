import type {
  GlyphPaint,
  GlyphRange,
  JsonValue,
  RasterGlyphInput,
  RasterGlyphWriteInput,
  RasterResourceId,
  RasterResourceSource,
  RasterTechnique,
  RasterTechniqueId,
  RegisteredFont,
  RegisteredRaster,
  Sha256Hex,
} from '@pmndrs/text';
import { defineRasterResourceId, defineRasterTechnique } from '@pmndrs/text';

import { isGlyphExampleHeader, type GlyphExampleExtensionV0 } from './artifact.js';
import {
  GLYPH_EXAMPLE_EXTENSION,
  GLYPH_EXAMPLE_FORMAT_VERSION,
  GLYPH_EXAMPLE_GENERATOR_VERSION,
  GLYPH_EXAMPLE_KIND,
  glyphExampleDescriptor,
  type GlyphExampleDescriptor,
  type GlyphExampleOptions,
} from './contract.js';

const RECORD_STRIDE = 4;

/**
 * The physical batch payload this technique needs while packing. Only the inset varies per decoded raster, so the
 * decoded data owns one frozen binding and every selection returns that same object identity.
 */
export interface GlyphExampleBinding {
  readonly inset: number;
}

export interface GlyphExampleData {
  readonly resource: RasterResourceId;
  readonly binding: GlyphExampleBinding;
  readonly colors: Uint8Array;
  readonly glyphCount: number;
}

export interface GlyphExampleGlyphBatchStorage {
  readonly origins: Float32Array;
  readonly sizes: Float32Array;
  readonly colors: Float32Array;
}

/**
 * A third-party portable raster technique. It owns decoding, selection, and canonical instance packing and never
 * mentions a renderer; the Three program in `./three.js` turns the packed storage into draws.
 */
export const glyphExample: RasterTechnique<
  RasterTechniqueId & 'studio.glyph-example',
  typeof GLYPH_EXAMPLE_KIND,
  GlyphExampleOptions | undefined,
  GlyphExampleDescriptor,
  GlyphExampleData,
  GlyphExampleBinding,
  GlyphExampleGlyphBatchStorage
> = defineRasterTechnique({
  id: 'studio.glyph-example',
  kind: GLYPH_EXAMPLE_KIND,
  extension: GLYPH_EXAMPLE_EXTENSION,
  version: GLYPH_EXAMPLE_FORMAT_VERSION,
  runtimeBaker: () => import('./runtime-baker.js'),
  descriptor(options: GlyphExampleOptions | undefined): GlyphExampleDescriptor {
    return glyphExampleDescriptor(options);
  },
  async decode(font, raster, signal): Promise<GlyphExampleData> {
    signal?.throwIfAborted();
    const extension = decodeExtension(font, raster);
    if (!isGlyphExampleHeader(raster.view(extension.headerBufferView))) {
      throw new TypeError('glyph-example artifact has an invalid package header');
    }
    const colors = Uint8Array.from(await raster.resource(extension.records, signal));
    signal?.throwIfAborted();
    if (colors.byteLength !== font.glyphCount * extension.recordStride) {
      throw new RangeError('glyph-example record payload length does not match the font glyph count');
    }
    return {
      resource: defineRasterResourceId(`studio.glyph-example/${font.shapingHash}/${raster.rasterKey}`),
      binding: Object.freeze({ inset: extension.descriptor.inset }),
      colors,
      glyphCount: font.glyphCount,
    };
  },
  select(input: RasterGlyphInput<GlyphExampleData>) {
    assertGlyphId(input.data, input.glyphId);
    if (!Number.isFinite(input.fontSize) || input.fontSize <= 0) {
      throw new TypeError('glyph-example font sizes must be positive finite values');
    }
    return { resource: input.data.resource, pipelineVariant: 0, binding: input.data.binding };
  },
  createStorage(capacity: number): GlyphExampleGlyphBatchStorage {
    if (!Number.isSafeInteger(capacity) || capacity < 0) {
      throw new RangeError('glyph-example storage capacity must be a non-negative safe integer');
    }
    return {
      origins: new Float32Array(capacity * 2),
      sizes: new Float32Array(capacity * 2),
      colors: new Float32Array(capacity * 4),
    };
  },
  writeStorage(
    storage: GlyphExampleGlyphBatchStorage,
    range: GlyphRange,
    input: RasterGlyphWriteInput<GlyphExampleData, GlyphExampleBinding>,
  ): void {
    assertWriteRange(storage, range, input.glyphs.length);
    if (input.binding !== input.data.binding) {
      throw new TypeError('glyph-example write binding does not belong to its data');
    }
    for (let index = 0; index < input.glyphs.length; index += 1) {
      writeGlyph(storage, range.start + index, input.data, input.binding, input.glyphs[index]!);
    }
  },
  validatePaint(paint: GlyphPaint): void {
    for (const entry of paint.palette) {
      if (entry.color.length !== 4 || entry.color.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
        throw new TypeError('glyph-example fill color must contain four finite linear values in [0, 1]');
      }
      if (entry.outline !== undefined || entry.shadow !== undefined) {
        throw new TypeError('glyph-example supports fill color and opacity only');
      }
    }
  },
  dispose(data: GlyphExampleData): void {
    data.colors.fill(0);
  },
});

function writeGlyph(
  storage: GlyphExampleGlyphBatchStorage,
  instance: number,
  data: GlyphExampleData,
  binding: GlyphExampleBinding,
  glyph: RasterGlyphInput<GlyphExampleData>,
): void {
  assertGlyphId(data, glyph.glyphId);
  if (!Number.isFinite(glyph.fontSize) || glyph.fontSize <= 0) {
    throw new TypeError('glyph-example font sizes must be positive finite values');
  }
  if (!Number.isFinite(glyph.originX) || !Number.isFinite(glyph.originY)) {
    throw new TypeError('glyph-example positions must be finite values');
  }
  if (glyph.paint.color.length !== 4) throw new TypeError('glyph-example paint must resolve four linear components');
  const inset = binding.inset * glyph.fontSize;
  const vectorOffset = instance * 2;
  storage.origins[vectorOffset] = glyph.originX + inset;
  storage.origins[vectorOffset + 1] = glyph.originY - glyph.fontSize * 0.8 + inset;
  storage.sizes[vectorOffset] = Math.max(glyph.fontSize * 0.05, glyph.fontSize * 0.65 - inset * 2);
  storage.sizes[vectorOffset + 1] = Math.max(glyph.fontSize * 0.05, glyph.fontSize - inset * 2);
  const record = glyph.glyphId * RECORD_STRIDE;
  const colorOffset = instance * 4;
  for (let channel = 0; channel < 4; channel += 1) {
    storage.colors[colorOffset + channel] = (data.colors[record + channel]! / 255) * glyph.paint.color[channel]!;
  }
}

function assertGlyphId(data: GlyphExampleData, glyphId: number): void {
  if (!Number.isSafeInteger(glyphId) || glyphId < 0 || glyphId >= data.glyphCount) {
    throw new RangeError('glyph-example layout references an unavailable glyph');
  }
}

function assertWriteRange(storage: GlyphExampleGlyphBatchStorage, range: GlyphRange, glyphCount: number): void {
  const capacity = storage.colors.length / 4;
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.count) ||
    range.start < 0 ||
    range.count < 0 ||
    range.count !== glyphCount ||
    range.start > capacity - range.count
  ) {
    throw new RangeError('glyph-example storage write range is outside its capacity');
  }
}

function decodeExtension(
  font: RegisteredFont,
  raster: RegisteredRaster<typeof GLYPH_EXAMPLE_KIND>,
): GlyphExampleExtensionV0 {
  const extension = objectValue(raster.extensionData, 'glyph-example extension');
  if (
    extension.version !== GLYPH_EXAMPLE_FORMAT_VERSION ||
    extension.rasterKey !== raster.rasterKey ||
    extension.shapingHash !== font.shapingHash ||
    extension.glyphCount !== font.glyphCount ||
    extension.glyphIdWidth !== 16 ||
    extension.recordStride !== RECORD_STRIDE
  ) {
    throw new TypeError('glyph-example extension identity does not match its registered font');
  }
  const descriptorValue = objectValue(extension.descriptor, 'glyph-example descriptor');
  if (descriptorValue.generatorVersion !== GLYPH_EXAMPLE_GENERATOR_VERSION) {
    throw new TypeError('glyph-example descriptor has an unsupported generator version');
  }
  const descriptor = glyphExampleDescriptor(descriptorValue);
  const headerBufferView = nonnegativeInteger(extension.headerBufferView, 'glyph-example headerBufferView');
  const records = resourceSource(extension.records);
  return {
    version: 0,
    rasterKey: raster.rasterKey,
    shapingHash: font.shapingHash,
    glyphCount: font.glyphCount,
    glyphIdWidth: 16,
    descriptor,
    headerBufferView,
    records,
    recordStride: RECORD_STRIDE,
  };
}

function resourceSource(value: unknown): RasterResourceSource {
  const source = objectValue(value, 'glyph-example records');
  if (source.type === 'bufferView') {
    return {
      type: 'bufferView',
      bufferView: nonnegativeInteger(source.bufferView, 'glyph-example records.bufferView'),
    };
  }
  if (source.type !== 'external') throw new TypeError('glyph-example record source has an unsupported type');
  if (typeof source.uri !== 'string' || source.uri.length === 0) {
    throw new TypeError('glyph-example external record source must have a URI');
  }
  if (typeof source.artifactHash !== 'string' || !/^[0-9a-f]{64}$/.test(source.artifactHash)) {
    throw new TypeError('glyph-example external record source must have a SHA-256 hash');
  }
  return {
    type: 'external',
    uri: source.uri,
    byteLength: nonnegativeInteger(source.byteLength, 'glyph-example records.byteLength'),
    artifactHash: source.artifactHash as Sha256Hex,
  };
}

function objectValue(value: JsonValue | unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new TypeError(`${label} must be a non-negative integer`);
  return value as number;
}
