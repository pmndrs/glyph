import {
  KHR_DF_CHANNEL_RGBSDA_ALPHA,
  KHR_DF_CHANNEL_RGBSDA_BLUE,
  KHR_DF_CHANNEL_RGBSDA_GREEN,
  KHR_DF_CHANNEL_RGBSDA_RED,
  VK_FORMAT_R16G16B16A16_SFLOAT,
} from 'ktx-parse';

import type { RegisteredFont } from '../font.js';
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
import type { JsonValue, RasterResourceSource, RegisteredRaster } from '../raster.js';
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

async function decodeSlugData(font: RegisteredFont, raster: RegisteredRaster, signal?: AbortSignal): Promise<SlugData> {
  if (
    raster.font !== font.handle ||
    raster.kind !== SLUG_KIND ||
    raster.extension !== SLUG_EXTENSION ||
    raster.version !== SLUG_FORMAT_VERSION
  ) {
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
  font: RegisteredFont,
  raster: RegisteredRaster,
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
  raster: RegisteredRaster,
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

import { defineTechniqueSchema, type TechniqueSchema } from '../core/technique-schema.js';

/**
 * The authoritative physical shape of the Slug technique.
 */
export const slugSchema: TechniqueSchema<
  {
    readonly rect: {
      readonly id: 1;
      readonly scalar: 'f32';
      readonly lanes: readonly ['left', 'top', 'width', 'height'];
    };
    readonly planeRect: {
      readonly id: 2;
      readonly scalar: 'f32';
      readonly lanes: readonly ['left', 'top', 'width', 'height'];
    };
    readonly bandTransform: {
      readonly id: 3;
      readonly scalar: 'f32';
      readonly lanes: readonly ['scaleX', 'scaleY', 'offsetX', 'offsetY'];
    };
    readonly color: {
      readonly id: 4;
      readonly scalar: 'f32';
      readonly lanes: readonly ['red', 'green', 'blue', 'alpha'];
    };
    readonly inverseFontSize: {
      readonly id: 5;
      readonly scalar: 'f32';
      readonly lanes: readonly ['inverseFontSize', 'unused1', 'unused2', 'unused3'];
    };
    readonly tableStarts: {
      readonly id: 6;
      readonly scalar: 'u32';
      readonly lanes: readonly ['curveStart', 'headerStart', 'referenceStart', 'bandStart'];
    };
    readonly bandCounts: {
      readonly id: 7;
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
      'curveStart',
      'headerStart',
      'referenceStart',
      'bandStart',
      'horizontalBands',
      'verticalBands',
    ];
  }
> = defineTechniqueSchema({
  technique: 'pmndrs.slug',
  scope: 'glyph',
  glyphOrigin: { buffer: 'rect' },
  binding: {
    f32: ['bearingX', 'bearingY', 'width', 'height', 'bandScaleX', 'bandScaleY', 'bandOffsetX', 'bandOffsetY'],
    u32: ['curveStart', 'headerStart', 'referenceStart', 'bandStart', 'horizontalBands', 'verticalBands'],
  },
  buffers: {
    rect: { id: 1, scalar: 'f32', lanes: ['left', 'top', 'width', 'height'] },
    planeRect: { id: 2, scalar: 'f32', lanes: ['left', 'top', 'width', 'height'] },
    bandTransform: { id: 3, scalar: 'f32', lanes: ['scaleX', 'scaleY', 'offsetX', 'offsetY'] },
    color: { id: 4, scalar: 'f32', lanes: ['red', 'green', 'blue', 'alpha'] },
    inverseFontSize: { id: 5, scalar: 'f32', lanes: ['inverseFontSize', 'unused1', 'unused2', 'unused3'] },
    tableStarts: { id: 6, scalar: 'u32', lanes: ['curveStart', 'headerStart', 'referenceStart', 'bandStart'] },
    bandCounts: { id: 7, scalar: 'u32', lanes: ['horizontalBands', 'verticalBands', 'unused2', 'unused3'] },
  },
  resources: {
    curves: { kind: 'texture-array' },
    headers: { kind: 'texture-array' },
    references: { kind: 'texture-array' },
  },
});
