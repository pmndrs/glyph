import type {
  JsonValue,
  RasterResourceId,
  RasterResourceSource,
  RasterDecodeArtifact,
  RasterDecodeFont,
  RasterTechnique,
  RasterTechniqueId,
  Sha256Hex,
} from '@pmndrs/glyph';
import { defineRasterResourceId, defineRasterTechnique } from '@pmndrs/glyph';

import { isGlyphExampleHeader, type GlyphExampleExtension } from './artifact.js';
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

export interface GlyphExampleData {
  readonly resource: RasterResourceId;
  readonly inset: number;
  readonly colors: Uint8Array;
  readonly glyphCount: number;
}

/**
 * A third-party portable raster technique. It owns identity, decoding, and resource lifetime and never mentions a
 * renderer; its shader subpaths consume the plan's named buffers and supplied geometry contract.
 */
export const glyphExample: RasterTechnique<
  RasterTechniqueId & 'studio.glyph-example',
  typeof GLYPH_EXAMPLE_KIND,
  GlyphExampleOptions | undefined,
  GlyphExampleDescriptor,
  GlyphExampleData
> = defineRasterTechnique({
  id: 'studio.glyph-example',
  kind: GLYPH_EXAMPLE_KIND,
  extension: GLYPH_EXAMPLE_EXTENSION,
  version: GLYPH_EXAMPLE_FORMAT_VERSION,
  textEffects: [],
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
      inset: extension.descriptor.inset,
      colors,
      glyphCount: font.glyphCount,
    };
  },
  dispose(data: GlyphExampleData): void {
    data.colors.fill(0);
  },
});

function decodeExtension(
  font: RasterDecodeFont,
  raster: RasterDecodeArtifact<typeof GLYPH_EXAMPLE_KIND>,
): GlyphExampleExtension {
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
