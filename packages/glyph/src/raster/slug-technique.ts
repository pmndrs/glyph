import {
  KHR_DF_CHANNEL_RGBSDA_ALPHA,
  KHR_DF_CHANNEL_RGBSDA_BLUE,
  KHR_DF_CHANNEL_RGBSDA_GREEN,
  KHR_DF_CHANNEL_RGBSDA_RED,
  VK_FORMAT_R16G16B16A16_SFLOAT,
} from 'ktx-parse';

import type { RasterDecodeFont } from '../font.js';
import type { Sha256Hex } from '../identity.js';
import { jsonArray, jsonObject, nonnegativeSafeInteger, positiveSafeInteger } from '../internal/raster-atlas.js';
import { validateNativeKtx2 } from '../internal/raster-ktx.js';
import {
  SLUG_EXTENSION,
  SLUG_FORMAT_VERSION,
  SLUG_GLYPH_RECORD_STRIDE,
  SLUG_KIND,
  SLUG_PLANE_UNITS_PER_EM,
  slugDescriptor,
  type SlugDescriptor,
} from '../internal/slug-contract.js';
import type { JsonValue, RasterDecodeArtifact, RasterResourceSource } from '../raster.js';
import {
  defineRasterResourceId,
  defineRasterTechnique,
  type RasterResourceId,
  type RasterTechnique,
  type RasterTechniqueId,
} from '../raster-technique.js';

export {
  SLUG_DEFAULT_BAND_COUNT,
  SLUG_EXTENSION,
  SLUG_FORMAT_VERSION,
  SLUG_GENERATOR_VERSION,
  SLUG_GLYPH_RECORD_STRIDE,
  SLUG_KIND,
  SLUG_PLANE_UNITS_PER_EM,
  slugDescriptor,
  slugDescriptorRasterKey,
  type SlugDescriptor,
} from '../internal/slug-contract.js';

const ABSENT_PAGE = 0xffff;
const MAX_TEXTURE_DIMENSION = 16_384;
const MAX_RUNTIME_RESOURCE_BYTES = 256 * 1024 * 1024;

export interface SlugPageData {
  readonly resource: RasterResourceId;
  readonly curveWidth: number;
  readonly curveHeight: number;
  readonly curveBytes: Uint8Array;
  readonly headerCount: number;
  readonly headerWidth: number;
  readonly headerHeight: number;
  readonly headerBytes: Uint8Array;
  readonly referenceCount: number;
  readonly referenceWidth: number;
  readonly referenceHeight: number;
  readonly referenceBytes: Uint8Array;
}

export interface SlugData {
  readonly planeUnitsPerEm: number;
  readonly records: Uint8Array;
  readonly pages: readonly SlugPageData[];
}

/** Renderer-neutral Slug identity, decoding, and ownership. */
export const slug: RasterTechnique<
  RasterTechniqueId & 'pmndrs.slug',
  typeof SLUG_KIND,
  undefined,
  SlugDescriptor,
  SlugData
> = defineRasterTechnique({
  id: 'pmndrs.slug',
  kind: SLUG_KIND,
  extension: SLUG_EXTENSION,
  version: SLUG_FORMAT_VERSION,
  runtimeBaker: () => import('../runtime-bakers/slug.js'),
  descriptor(): SlugDescriptor {
    return slugDescriptor();
  },
  async decode(font, raster, signal): Promise<SlugData> {
    signal?.throwIfAborted();
    const data = await decodeSlugData(font, raster, signal);
    signal?.throwIfAborted();
    return data;
  },
  dispose() {},
});

async function decodeSlugData(
  font: RasterDecodeFont,
  raster: RasterDecodeArtifact,
  signal?: AbortSignal,
): Promise<SlugData> {
  if (raster.kind !== SLUG_KIND || raster.extension !== SLUG_EXTENSION || raster.version !== SLUG_FORMAT_VERSION) {
    throw new TypeError('Slug raster is not bound to the supplied font');
  }
  const extension = jsonObject(raster.extensionData, 'Slug extension');
  if (
    extension.version !== SLUG_FORMAT_VERSION ||
    extension.rasterKey !== raster.rasterKey ||
    extension.shapingHash !== font.shapingHash ||
    extension.glyphCount !== font.glyphCount ||
    extension.glyphIdWidth !== 16 ||
    extension.planeUnitsPerEm !== SLUG_PLANE_UNITS_PER_EM ||
    extension.recordStride !== SLUG_GLYPH_RECORD_STRIDE
  ) {
    throw new TypeError('Slug extension does not match the fixed runtime contract');
  }
  const records = raster.view(nonnegativeSafeInteger(extension.recordBufferView, 'Slug recordBufferView'));
  if (records.byteLength !== font.glyphCount * SLUG_GLYPH_RECORD_STRIDE) {
    throw new TypeError('Slug record table does not match the registered glyph count');
  }
  const pageValues = jsonArray(extension.pages, 'Slug pages');
  if (pageValues.length === 0 || pageValues.length > 65_535) {
    throw new TypeError('Slug raster must contain 1..=65535 pages');
  }
  const pages: SlugPageData[] = [];
  let retainedBytes = 0;
  for (let pageIndex = 0; pageIndex < pageValues.length; pageIndex += 1) {
    const page = await decodeSlugPage(font, raster, pageValues[pageIndex]!, pageIndex, signal);
    pages.push(page);
    retainedBytes = checkedBytes(
      retainedBytes,
      page.curveBytes.byteLength + page.headerBytes.byteLength + page.referenceBytes.byteLength,
    );
  }
  validateSlugRecordTable(records, pages, font.glyphCount);
  return { planeUnitsPerEm: SLUG_PLANE_UNITS_PER_EM, records, pages };
}

async function decodeSlugPage(
  font: RasterDecodeFont,
  raster: RasterDecodeArtifact,
  value: JsonValue,
  pageIndex: number,
  signal?: AbortSignal,
): Promise<SlugPageData> {
  const path = `Slug page ${pageIndex}`;
  const page = jsonObject(value, path);
  const curve = jsonObject(page.curve, `${path} curve`);
  const curveWidth = textureDimension(curve.width, `${path} curve width`);
  const curveHeight = textureDimension(curve.height, `${path} curve height`);
  if (curve.mipLevelCount !== 1 || curve.colorSpace !== 'linear') {
    throw new TypeError(`${path} curve must be a single-level linear texture`);
  }
  const variants = jsonArray(curve.variants, `${path} curve variants`);
  if (variants.length !== 1) throw new TypeError(`${path} must contain one curve variant`);
  const variant = jsonObject(variants[0], `${path} curve variant`);
  if (
    variant.container !== 'ktx2' ||
    variant.gpuFormat !== 'rgba16float' ||
    variant.quality !== 'lossless' ||
    variant.requiredFeature !== undefined
  ) {
    throw new TypeError(`${path} curve does not match the lossless RGBA16F baseline`);
  }
  const curveContainerBytes = await rasterResourceBytes(raster, variant.source, `${path} curve source`, signal);
  const curveContainer = validateNativeKtx2(curveContainerBytes, curveWidth, curveHeight, {
    vkFormat: VK_FORMAT_R16G16B16A16_SFLOAT,
    typeSize: 2,
    blockWidth: 1,
    blockHeight: 1,
    bytesPerBlock: 8,
    float16ChannelTypes: [
      KHR_DF_CHANNEL_RGBSDA_RED,
      KHR_DF_CHANNEL_RGBSDA_GREEN,
      KHR_DF_CHANNEL_RGBSDA_BLUE,
      KHR_DF_CHANNEL_RGBSDA_ALPHA,
    ],
  });
  const curveLevel = curveContainer.levels[0];
  if (curveLevel === undefined) throw new TypeError(`${path} curve has no base level`);
  const curveBytes = curveLevel.levelData.slice();

  const headerWidth = textureDimension(page.headerWidth, `${path} header width`);
  const headerHeight = textureDimension(page.headerHeight, `${path} header height`);
  const headerCapacity = checkedProduct(headerWidth, headerHeight, `${path} header dimensions`);
  const headerCount = boundedCount(page.headerCount, headerCapacity, `${path} header count`);
  const headerResource = jsonObject(page.headerResource, `${path} header resource`);
  const headerBytes = (
    await rasterResourceBytes(raster, headerResource.source, `${path} header source`, signal)
  ).slice();
  assertGridLength(headerBytes, headerCapacity, 4, `${path} header`);

  const referenceWidth = textureDimension(page.referenceWidth, `${path} reference width`);
  const referenceHeight = textureDimension(page.referenceHeight, `${path} reference height`);
  const referenceCapacity = checkedProduct(referenceWidth, referenceHeight, `${path} reference dimensions`);
  const referenceCount = boundedCount(page.referenceCount, referenceCapacity, `${path} reference count`);
  const referenceResource = jsonObject(page.referenceResource, `${path} reference resource`);
  const referenceBytes = (
    await rasterResourceBytes(raster, referenceResource.source, `${path} reference source`, signal)
  ).slice();
  assertGridLength(referenceBytes, referenceCapacity, 2, `${path} reference`);

  return {
    resource: defineRasterResourceId(`pmndrs.slug/${font.shapingHash}/${raster.rasterKey}/${pageIndex}`),
    curveWidth,
    curveHeight,
    curveBytes,
    headerCount,
    headerWidth,
    headerHeight,
    headerBytes,
    referenceCount,
    referenceWidth,
    referenceHeight,
    referenceBytes,
  };
}

async function rasterResourceBytes(
  raster: RasterDecodeArtifact,
  value: JsonValue | undefined,
  path: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const source = jsonObject(value, path);
  let resource: RasterResourceSource;
  if (source.type === 'bufferView') {
    resource = { type: 'bufferView', bufferView: nonnegativeSafeInteger(source.bufferView, `${path} bufferView`) };
  } else if (source.type === 'external') {
    resource = {
      type: 'external',
      uri: nonemptyString(source.uri, `${path} uri`),
      byteLength: positiveSafeInteger(source.byteLength, `${path} byteLength`),
      artifactHash: sha256Hex(source.artifactHash, `${path} artifactHash`),
    };
  } else {
    throw new TypeError(`${path} must be a bufferView or authenticated external resource`);
  }
  return raster.resource(resource, signal);
}

function validateSlugRecordTable(records: Uint8Array, pages: readonly SlugPageData[], glyphCount: number): void {
  const view = new DataView(records.buffer, records.byteOffset, records.byteLength);
  for (let glyphId = 0; glyphId < glyphCount; glyphId += 1) {
    const offset = glyphId * SLUG_GLYPH_RECORD_STRIDE;
    const pageIndex = view.getUint16(offset + 8, true);
    if (pageIndex === ABSENT_PAGE) {
      if (!absentRecordIsCanonical(records, offset)) {
        throw new TypeError(`Slug glyph ${glyphId} has non-canonical absent data`);
      }
      continue;
    }
    const page = pages[pageIndex];
    if (page === undefined) throw new TypeError(`Slug glyph ${glyphId} references a missing page`);
    const left = view.getInt16(offset, true);
    const bottom = view.getInt16(offset + 2, true);
    const right = view.getInt16(offset + 4, true);
    const top = view.getInt16(offset + 6, true);
    const horizontalBands = view.getUint16(offset + 10, true);
    const verticalBands = view.getUint16(offset + 12, true);
    if (
      left >= right ||
      bottom >= top ||
      horizontalBands === 0 ||
      verticalBands === 0 ||
      view.getUint16(offset + 14, true) !== 0
    ) {
      throw new TypeError(`Slug glyph ${glyphId} has invalid bounds, bands, or flags`);
    }
    assertAddressRange(
      view.getUint32(offset + 16, true),
      view.getUint32(offset + 20, true),
      page.curveWidth * page.curveHeight,
      `Slug glyph ${glyphId} curve`,
    );
    assertAddressRange(
      view.getUint32(offset + 24, true),
      horizontalBands,
      page.headerCount,
      `Slug glyph ${glyphId} horizontal headers`,
    );
    assertAddressRange(
      view.getUint32(offset + 28, true),
      verticalBands,
      page.headerCount,
      `Slug glyph ${glyphId} vertical headers`,
    );
    assertAddressRange(
      view.getUint32(offset + 32, true),
      view.getUint32(offset + 36, true),
      page.referenceCount,
      `Slug glyph ${glyphId} references`,
    );
  }
}

function absentRecordIsCanonical(records: Uint8Array, offset: number): boolean {
  for (let byte = 0; byte < SLUG_GLYPH_RECORD_STRIDE; byte += 1) {
    if (byte === 8 || byte === 9) continue;
    if (records[offset + byte] !== 0) return false;
  }
  return true;
}

function assertAddressRange(base: number, count: number, capacity: number, label: string): void {
  if (count === 0 || base > capacity - count) {
    throw new TypeError(`${label} range is empty or outside its page resource`);
  }
}

function nonemptyString(value: JsonValue | undefined, path: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${path} must be a nonempty string`);
  return value;
}

function sha256Hex(value: JsonValue | undefined, path: string): Sha256Hex {
  const text = nonemptyString(value, path);
  if (!/^[0-9a-f]{64}$/.test(text)) throw new TypeError(`${path} must be lowercase SHA-256`);
  return text as Sha256Hex;
}

function textureDimension(value: JsonValue | undefined, path: string): number {
  const dimension = positiveSafeInteger(value, path);
  if (dimension > MAX_TEXTURE_DIMENSION) throw new RangeError(`${path} exceeds ${MAX_TEXTURE_DIMENSION}`);
  return dimension;
}

function boundedCount(value: JsonValue | undefined, capacity: number, path: string): number {
  const count = positiveSafeInteger(value, path);
  if (count > capacity) throw new TypeError(`${path} exceeds its grid capacity`);
  return count;
}

function assertGridLength(bytes: Uint8Array, texels: number, bytesPerTexel: number, path: string): void {
  const expected = checkedProduct(texels, bytesPerTexel, `${path} byte length`);
  if (bytes.byteLength !== expected) throw new TypeError(`${path} byte length does not match its dimensions`);
}

function checkedProduct(left: number, right: number, path: string): number {
  const product = left * right;
  if (!Number.isSafeInteger(product)) throw new RangeError(`${path} overflow`);
  return product;
}

function checkedBytes(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total) || total > MAX_RUNTIME_RESOURCE_BYTES) {
    throw new RangeError('Slug pages exceed the runtime resource-memory limit');
  }
  return total;
}

import { f32, id, techniqueProgram, u32, type PolicyBufferId, type RasterPlanProgram } from '../core.js';
import { registerGlyphRasterPlanProgram } from '../core/raster-plan-program.js';
import { defineTechniqueSchema, type TechniqueSchema } from '../core/technique-schema.js';

const SLUG_RECT_BUFFER_ID: PolicyBufferId = id('buffer', 'pmndrs.slug/rect');
const SLUG_PLANE_RECT_BUFFER_ID: PolicyBufferId = id('buffer', 'pmndrs.slug/plane-rect');
const SLUG_BAND_TRANSFORM_BUFFER_ID: PolicyBufferId = id('buffer', 'pmndrs.slug/band-transform');
const SLUG_COLOR_BUFFER_ID: PolicyBufferId = id('buffer', 'pmndrs.slug/color');
const SLUG_INVERSE_FONT_SIZE_BUFFER_ID: PolicyBufferId = id('buffer', 'pmndrs.slug/inverse-font-size');
const SLUG_TABLE_STARTS_BUFFER_ID: PolicyBufferId = id('buffer', 'pmndrs.slug/table-starts');
const SLUG_BAND_COUNTS_BUFFER_ID: PolicyBufferId = id('buffer', 'pmndrs.slug/band-counts');

/**
 * The authoritative physical shape of the Slug technique.
 */
export const slugSchema: TechniqueSchema<
  {
    readonly rect: {
      readonly id: typeof SLUG_RECT_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['left', 'top', 'width', 'height'];
    };
    readonly planeRect: {
      readonly id: typeof SLUG_PLANE_RECT_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['left', 'top', 'width', 'height'];
    };
    readonly bandTransform: {
      readonly id: typeof SLUG_BAND_TRANSFORM_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['scaleX', 'scaleY', 'offsetX', 'offsetY'];
    };
    readonly color: {
      readonly id: typeof SLUG_COLOR_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['red', 'green', 'blue', 'alpha'];
    };
    readonly inverseFontSize: {
      readonly id: typeof SLUG_INVERSE_FONT_SIZE_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['inverseFontSize', 'unused1', 'unused2', 'unused3'];
    };
    readonly tableStarts: {
      readonly id: typeof SLUG_TABLE_STARTS_BUFFER_ID;
      readonly scalar: 'u32';
      readonly lanes: readonly ['curveBase', 'horizontalHeaderBase', 'verticalHeaderBase', 'referenceBase'];
    };
    readonly bandCounts: {
      readonly id: typeof SLUG_BAND_COUNTS_BUFFER_ID;
      readonly scalar: 'u32';
      readonly lanes: readonly ['horizontalBands', 'verticalBands', 'unused2', 'unused3'];
    };
  },
  {
    readonly f32: readonly [
      'bearingX',
      'bearingY',
      'width',
      'height',
      'bandScaleX',
      'bandScaleY',
      'bandOffsetX',
      'bandOffsetY',
    ];
    readonly u32: readonly [
      'curveBase',
      'horizontalHeaderBase',
      'verticalHeaderBase',
      'referenceBase',
      'horizontalBands',
      'verticalBands',
    ];
  },
  {
    readonly page: {
      readonly kind: 'group';
      readonly cardinality: 'many';
      readonly members: {
        readonly curves: { readonly kind: 'texture'; readonly format: 'rgba16float' };
        readonly headers: { readonly kind: 'texture'; readonly format: 'r32uint' };
        readonly references: { readonly kind: 'texture'; readonly format: 'r32uint' };
      };
    };
  },
  typeof slug.id
> = defineTechniqueSchema({
  technique: slug.id,
  scope: 'glyph',
  glyphOrigin: { buffer: 'rect' },
  binding: {
    f32: ['bearingX', 'bearingY', 'width', 'height', 'bandScaleX', 'bandScaleY', 'bandOffsetX', 'bandOffsetY'],
    u32: [
      'curveBase',
      'horizontalHeaderBase',
      'verticalHeaderBase',
      'referenceBase',
      'horizontalBands',
      'verticalBands',
    ],
  },
  buffers: {
    rect: { id: SLUG_RECT_BUFFER_ID, scalar: 'f32', lanes: ['left', 'top', 'width', 'height'] },
    planeRect: { id: SLUG_PLANE_RECT_BUFFER_ID, scalar: 'f32', lanes: ['left', 'top', 'width', 'height'] },
    bandTransform: {
      id: SLUG_BAND_TRANSFORM_BUFFER_ID,
      scalar: 'f32',
      lanes: ['scaleX', 'scaleY', 'offsetX', 'offsetY'],
    },
    color: { id: SLUG_COLOR_BUFFER_ID, scalar: 'f32', lanes: ['red', 'green', 'blue', 'alpha'] },
    inverseFontSize: {
      id: SLUG_INVERSE_FONT_SIZE_BUFFER_ID,
      scalar: 'f32',
      lanes: ['inverseFontSize', 'unused1', 'unused2', 'unused3'],
    },
    tableStarts: {
      id: SLUG_TABLE_STARTS_BUFFER_ID,
      scalar: 'u32',
      lanes: ['curveBase', 'horizontalHeaderBase', 'verticalHeaderBase', 'referenceBase'],
    },
    bandCounts: {
      id: SLUG_BAND_COUNTS_BUFFER_ID,
      scalar: 'u32',
      lanes: ['horizontalBands', 'verticalBands', 'unused2', 'unused3'],
    },
  },
  resources: {
    page: {
      kind: 'group',
      cardinality: 'many',
      members: {
        curves: { kind: 'texture', format: 'rgba16float' },
        headers: { kind: 'texture', format: 'r32uint' },
        references: { kind: 'texture', format: 'r32uint' },
      },
    },
  },
  render: { resource: 'page', geometry: { kind: 'synthetic-quad' } },
});

export const slugPlanProgram: RasterPlanProgram<typeof slug, typeof slugSchema> = registerGlyphRasterPlanProgram({
  technique: slug,
  schema: slugSchema,
  policyBody(system) {
    const p = techniqueProgram(slugSchema, { inverseFontSize: true, system });
    const { inlineOrigin, blockOrigin, fontSize, color, inverseFontSize } = p.semantics;
    if (inverseFontSize === undefined) throw new TypeError('the Slug program declares inverseFontSize');
    const {
      bearingX,
      bearingY,
      width,
      height,
      bandScaleX,
      bandScaleY,
      bandOffsetX,
      bandOffsetY,
      curveBase,
      horizontalHeaderBase,
      verticalHeaderBase,
      referenceBase,
      horizontalBands,
      verticalBands,
    } = p.binding;
    const zeroF32 = f32.const(0);
    const zeroU32 = u32.const(0);
    return p.compile({
      rect: [
        f32.add(inlineOrigin, f32.mul(bearingX, fontSize)),
        f32.sub(blockOrigin, f32.mul(bearingY, fontSize)),
        f32.mul(width, fontSize),
        f32.mul(height, fontSize),
      ],
      planeRect: [bearingX, bearingY, width, height],
      bandTransform: [bandScaleX, bandScaleY, bandOffsetX, bandOffsetY],
      color: [color.red, color.green, color.blue, color.alpha],
      inverseFontSize: [inverseFontSize, zeroF32, zeroF32, zeroF32],
      tableStarts: [curveBase, horizontalHeaderBase, verticalHeaderBase, referenceBase],
      bandCounts: [horizontalBands, verticalBands, zeroU32, zeroU32],
    });
  },
  compileFont(compiler) {
    const data = compiler.font.data;
    for (const page of data.pages) compiler.retain('page', page.resource, slugPagePayload(page));
    const view = new DataView(data.records.buffer, data.records.byteOffset);
    const record = (row: number) => row * SLUG_GLYPH_RECORD_STRIDE;
    const page = (row: number) => view.getUint16(record(row) + 8, true);
    const normalized = (row: number, offset: number) =>
      view.getInt16(record(row) + offset, true) / data.planeUnitsPerEm;
    const width = (row: number) => normalized(row, 4) - normalized(row, 0);
    const height = (row: number) => normalized(row, 6) - normalized(row, 2);
    const horizontalBands = (row: number) => view.getUint16(record(row) + 10, true);
    const verticalBands = (row: number) => view.getUint16(record(row) + 12, true);
    const bandScaleX = (row: number) => (width(row) === 0 ? 0 : verticalBands(row) / width(row));
    const bandScaleY = (row: number) => (height(row) === 0 ? 0 : horizontalBands(row) / height(row));
    return compiler.compile({
      strikes: [0],
      resource: (glyph) => {
        const selected = page(glyph);
        return selected === ABSENT_PAGE ? undefined : data.pages[selected]!.resource;
      },
      f32: {
        bearingX: (row) => normalized(row, 0),
        bearingY: (row) => normalized(row, 6),
        width,
        height,
        bandScaleX,
        bandScaleY,
        bandOffsetX: (row) => -normalized(row, 0) * bandScaleX(row),
        bandOffsetY: (row) => -normalized(row, 2) * bandScaleY(row),
      },
      u32: {
        curveBase: (row) => view.getUint32(record(row) + 16, true),
        horizontalHeaderBase: (row) => view.getUint32(record(row) + 24, true),
        verticalHeaderBase: (row) => view.getUint32(record(row) + 28, true),
        referenceBase: (row) => view.getUint32(record(row) + 32, true),
        horizontalBands,
        verticalBands,
      },
    });
  },
});

function slugPagePayload(page: SlugPageData) {
  const references = packSlugReferences(page.referenceBytes, page.referenceWidth);
  return {
    kind: 'group' as const,
    members: {
      curves: {
        kind: 'texture' as const,
        format: 'rgba16float' as const,
        width: page.curveWidth,
        height: page.curveHeight,
        bytes: page.curveBytes,
      },
      headers: {
        kind: 'texture' as const,
        format: 'r32uint' as const,
        width: page.headerWidth,
        height: page.headerHeight,
        bytes: page.headerBytes,
      },
      references: {
        kind: 'texture' as const,
        format: 'r32uint' as const,
        width: references.width,
        height: references.height,
        bytes: new Uint8Array(references.data.buffer),
      },
    },
  };
}

function packSlugReferences(bytes: Uint8Array, preferredWidth: number) {
  const copied = bytes.slice();
  const references = new Uint16Array(copied.buffer, copied.byteOffset, copied.byteLength / 2);
  const texelCount = Math.ceil(references.length / 2);
  const width = Math.min(preferredWidth, texelCount);
  const height = Math.ceil(texelCount / width);
  const data = new Uint32Array(width * height);
  for (let index = 0; index < references.length; index += 1) {
    data[index >> 1] = (data[index >> 1] ?? 0) | (references[index]! << ((index & 1) * 16));
  }
  return { data, width, height };
}
