import {
  KHR_DF_CHANNEL_RGBSDA_ALPHA,
  KHR_DF_CHANNEL_RGBSDA_BLUE,
  KHR_DF_CHANNEL_RGBSDA_GREEN,
  KHR_DF_CHANNEL_RGBSDA_RED,
  VK_FORMAT_R16G16B16A16_SFLOAT,
} from 'ktx-parse';
import * as THREE from 'three/webgpu';
import type { Node, UniformNode } from 'three/webgpu';
import { Fn, add, attribute, bool, mul, positionLocal, sub, uniform, varyingProperty, vec2, vec3 } from 'three/tsl';

import type { RegisteredFont } from '../font.js';
import type { Sha256Hex } from '../identity.js';
import { assertParallelRasterLayout, unitRasterQuadGeometry } from '../internal/raster-batch.js';
import {
  coalesceRasterInstanceRanges,
  pendingRasterDirtyInstances,
  rasterInstanceCapacity,
  rasterInstanceUpdateRanges,
} from '../internal/raster-instance-capacity.js';
import { jsonArray, jsonObject, nonnegativeSafeInteger, positiveSafeInteger } from '../internal/raster-atlas.js';
import { validateNativeKtx2 } from '../internal/raster-ktx.js';
import {
  SLUG_EXTENSION,
  SLUG_FORMAT_VERSION,
  SLUG_GLYPH_RECORD_STRIDE,
  SLUG_KIND,
  SLUG_PLANE_UNITS_PER_EM,
  slugDescriptor,
} from '../internal/slug-contract.js';
import { slugDilate, slugRender, type SlugShaderPage } from '../internal/slug-shaders/index.js';
import type { ParagraphLayout } from '../layout.js';
import type { GlyphPaint, ResolvedPaint } from '../paint.js';
import {
  defineRaster,
  defineRasterBatchStage,
  type JsonValue,
  type RasterModule,
  type RasterResourceSource,
  type RegisteredRaster,
} from '../raster.js';

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
  type SlugDescriptorV0,
} from '../internal/slug-contract.js';

const ABSENT_PAGE = 0xffff;
const MAX_TEXTURE_DIMENSION = 16_384;
const MAX_RUNTIME_GPU_BYTES = 256 * 1024 * 1024;
const SLUG_FLOAT_INSTANCE_STRIDE = 17;
const SLUG_FLOAT_INSTANCE_OFFSETS = {
  origin: 0,
  size: 2,
  emOrigin: 4,
  emSize: 6,
  inverseScale: 8,
  bandTransform: 9,
  color: 13,
} as const;
const SLUG_UINT_INSTANCE_STRIDE = 6;
const SLUG_UINT_INSTANCE_OFFSETS = {
  curveBase: 0,
  horizontalHeaderBase: 1,
  verticalHeaderBase: 2,
  referenceBase: 3,
  horizontalBandCount: 4,
  verticalBandCount: 5,
} as const;
const drawingBufferSize = new THREE.Vector2();
const modelViewProjectionMatrix = new THREE.Matrix4();

interface SlugMaterialState {
  readonly material: THREE.MeshBasicNodeMaterial;
  readonly viewport: UniformNode<'vec2', THREE.Vector2>;
  readonly mvpRow0: UniformNode<'vec4', THREE.Vector4>;
  readonly mvpRow1: UniformNode<'vec4', THREE.Vector4>;
  readonly mvpRow3: UniformNode<'vec4', THREE.Vector4>;
}

export interface SlugPageResource extends SlugShaderPage {
  readonly curveHeight: number;
  readonly headerCount: number;
  readonly headerHeight: number;
  readonly referenceCount: number;
  readonly referenceHeight: number;
  /** Exact uploaded bytes: RGBA16F curves + R32UI headers + packed reference pairs in R32UI. */
  readonly gpuBytes: number;
}

export interface SlugResource {
  readonly planeUnitsPerEm: number;
  readonly records: Uint8Array;
  readonly pages: readonly SlugPageResource[];
  readonly gpuBytes: number;
}

interface SlugBatchRun {
  readonly capacity: number;
  readonly glyphIndices: Uint32Array;
  logicalCount: number;
  readonly floatData: THREE.InstancedInterleavedBuffer;
  readonly uintData: THREE.InstancedInterleavedBuffer;
  readonly geometry: THREE.InstancedBufferGeometry;
  readonly fillMesh: THREE.Mesh;
  readonly materialState: SlugMaterialState;
  readonly pageIndex: number;
}

export interface SlugDrawBatch {
  readonly object: THREE.Group;
  readonly glyphCount: number;
  readonly drawCount: number;
  dispose(): void;
}

const materialStateByCurveTexture = new WeakMap<THREE.DataTexture, SlugMaterialState>();
interface SlugBatchContext {
  layout: ParagraphLayout;
  readonly resource: SlugResource;
  readonly fontSlot: number;
  readonly runs: readonly SlugBatchRun[];
}

const batchContext = new WeakMap<SlugDrawBatch, SlugBatchContext>();

const slugModule: RasterModule<typeof SLUG_KIND, SlugResource, SlugDrawBatch> = defineRaster({
  kind: SLUG_KIND,
  extension: SLUG_EXTENSION,
  version: SLUG_FORMAT_VERSION,
  runtimeBaker: () => import('../runtime-bakers/slug.js'),
  descriptor: slugDescriptor,
  async decode(font, raster, signal) {
    signal?.throwIfAborted();
    const resource = await decodeSlugResource(font, raster, signal);
    signal?.throwIfAborted();
    return resource;
  },
  prepare(_layout, _resource, _fontSlot, signal) {
    signal?.throwIfAborted();
  },
  stageBatch(previous, layout, resource, fontSlot, paint) {
    assertParallelRasterLayout(layout, paint);
    assertSlugPaint(paint);
    assertSlugGlyphInputs(layout, resource, fontSlot, paint);
    if (previous !== undefined) {
      const update = stageSlugBatchUpdate(previous, layout, resource, fontSlot, paint);
      if (update !== undefined) return defineRasterBatchStage(previous, update.commit, update.dispose);
    }
    const batch = buildSlugBatches(layout, resource, fontSlot, paint);
    return defineRasterBatchStage(
      batch,
      () => undefined,
      () => batch.dispose(),
    );
  },
  validatePaint: assertSlugPaint,
  dispose(resource) {
    disposeSlugResource(resource);
  },
});

export type SlugModule = typeof slugModule;

/** Fixed analytic Slug raster module for `defineFont(source, slug)`. */
export const slug: SlugModule = slugModule;

async function decodeSlugResource(
  font: RegisteredFont,
  raster: RegisteredRaster,
  signal?: AbortSignal,
): Promise<SlugResource> {
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

  const pages: SlugPageResource[] = [];
  try {
    let gpuBytes = 0;
    for (let pageIndex = 0; pageIndex < pageValues.length; pageIndex += 1) {
      const page = await decodeSlugPage(raster, pageValues[pageIndex]!, pageIndex, signal);
      pages.push(page);
      gpuBytes = checkedGpuBytes(gpuBytes, page.gpuBytes);
    }
    validateSlugRecordTable(records, pages, font.glyphCount);
    return {
      planeUnitsPerEm: SLUG_PLANE_UNITS_PER_EM,
      records,
      pages,
      gpuBytes,
    };
  } catch (error) {
    for (const page of pages) disposeSlugPage(page);
    throw error;
  }
}

async function decodeSlugPage(
  raster: RegisteredRaster,
  value: JsonValue,
  pageIndex: number,
  signal?: AbortSignal,
): Promise<SlugPageResource> {
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

  const curveBytes = await rasterResourceBytes(raster, variant.source, `${path} curve source`, signal);
  const curveContainer = validateNativeKtx2(curveBytes, curveWidth, curveHeight, {
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

  const headerWidth = textureDimension(page.headerWidth, `${path} header width`);
  const headerHeight = textureDimension(page.headerHeight, `${path} header height`);
  const headerCapacity = checkedProduct(headerWidth, headerHeight, `${path} header dimensions`);
  const headerCount = boundedCount(page.headerCount, headerCapacity, `${path} header count`);
  const headerResource = jsonObject(page.headerResource, `${path} header resource`);
  const headerBytes = await rasterResourceBytes(raster, headerResource.source, `${path} header source`, signal);
  assertGridLength(headerBytes, headerCapacity, 4, `${path} header`);

  const referenceWidth = textureDimension(page.referenceWidth, `${path} reference width`);
  const referenceHeight = textureDimension(page.referenceHeight, `${path} reference height`);
  const referenceCapacity = checkedProduct(referenceWidth, referenceHeight, `${path} reference dimensions`);
  const referenceCount = boundedCount(page.referenceCount, referenceCapacity, `${path} reference count`);
  const referenceResource = jsonObject(page.referenceResource, `${path} reference resource`);
  const referenceBytes = await rasterResourceBytes(
    raster,
    referenceResource.source,
    `${path} reference source`,
    signal,
  );
  assertGridLength(referenceBytes, referenceCapacity, 2, `${path} reference`);

  const curveTexture = dataTexture(
    ownedUint16(curveLevel.levelData),
    curveWidth,
    curveHeight,
    THREE.RGBAFormat,
    THREE.HalfFloatType,
  );
  const headerTexture = dataTexture(
    ownedUint32(headerBytes),
    headerWidth,
    headerHeight,
    THREE.RedIntegerFormat,
    THREE.UnsignedIntType,
  );
  const packedReferences = packReferencePairs(ownedUint16(referenceBytes), referenceWidth);
  const referenceTexture = dataTexture(
    packedReferences.data,
    packedReferences.width,
    packedReferences.height,
    THREE.RedIntegerFormat,
    THREE.UnsignedIntType,
  );
  return {
    curveWidth,
    curveHeight,
    curveTexture,
    headerCount,
    headerWidth,
    headerHeight,
    headerTexture,
    referenceCount,
    referenceWidth: packedReferences.width,
    referenceHeight: packedReferences.height,
    referenceTexture,
    gpuBytes: checkedGpuBytes(
      checkedProduct(curveWidth, curveHeight, `${path} curve dimensions`) * 8,
      headerCapacity * 4 + packedReferences.data.byteLength,
    ),
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
    resource = {
      type: 'bufferView',
      bufferView: nonnegativeSafeInteger(source.bufferView, `${path} bufferView`),
    };
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

function nonemptyString(value: JsonValue | undefined, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${path} must be a nonempty string`);
  }
  return value;
}

function sha256Hex(value: JsonValue | undefined, path: string): Sha256Hex {
  const text = nonemptyString(value, path);
  if (!/^[0-9a-f]{64}$/.test(text)) throw new TypeError(`${path} must be lowercase SHA-256`);
  return text as Sha256Hex;
}

function dataTexture(
  data: Uint16Array | Uint32Array,
  width: number,
  height: number,
  format: THREE.PixelFormat,
  type: THREE.TextureDataType,
): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, width, height, format, type);
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

function packReferencePairs(
  references: Uint16Array,
  preferredWidth: number,
): { readonly data: Uint32Array; readonly width: number; readonly height: number } {
  const texelCount = Math.ceil(references.length / 2);
  const width = Math.min(preferredWidth, texelCount);
  const height = Math.ceil(texelCount / width);
  const data = new Uint32Array(width * height);
  for (let index = 0; index < references.length; index += 1) {
    data[index >>> 1] = data[index >>> 1]! | (references[index]! << ((index & 1) * 16));
  }
  return { data, width, height };
}

function validateSlugRecordTable(records: Uint8Array, pages: readonly SlugPageResource[], glyphCount: number): void {
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
    const planeLeft = view.getInt16(offset, true);
    const planeBottom = view.getInt16(offset + 2, true);
    const planeRight = view.getInt16(offset + 4, true);
    const planeTop = view.getInt16(offset + 6, true);
    const horizontalBandCount = view.getUint16(offset + 10, true);
    const verticalBandCount = view.getUint16(offset + 12, true);
    if (
      planeLeft >= planeRight ||
      planeBottom >= planeTop ||
      horizontalBandCount === 0 ||
      verticalBandCount === 0 ||
      view.getUint16(offset + 14, true) !== 0
    ) {
      throw new TypeError(`Slug glyph ${glyphId} has invalid bounds, bands, or flags`);
    }
    const curveBase = view.getUint32(offset + 16, true);
    const curveSpan = view.getUint32(offset + 20, true);
    const horizontalHeaderBase = view.getUint32(offset + 24, true);
    const verticalHeaderBase = view.getUint32(offset + 28, true);
    const referenceBase = view.getUint32(offset + 32, true);
    const referenceCount = view.getUint32(offset + 36, true);
    assertAddressRange(curveBase, curveSpan, page.curveWidth * page.curveHeight, `Slug glyph ${glyphId} curve`);
    assertAddressRange(
      horizontalHeaderBase,
      horizontalBandCount,
      page.headerCount,
      `Slug glyph ${glyphId} horizontal headers`,
    );
    assertAddressRange(
      verticalHeaderBase,
      verticalBandCount,
      page.headerCount,
      `Slug glyph ${glyphId} vertical headers`,
    );
    assertAddressRange(referenceBase, referenceCount, page.referenceCount, `Slug glyph ${glyphId} references`);
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

function buildSlugBatches(
  layout: ParagraphLayout,
  resource: SlugResource,
  fontSlot: number,
  paint: GlyphPaint,
): SlugDrawBatch {
  assertParallelRasterLayout(layout, paint);
  assertSlugPaint(paint);
  assertSlugGlyphInputs(layout, resource, fontSlot, paint);
  const group = new THREE.Group();
  group.name = 'pmndrs.text.slug';
  const runs: SlugBatchRun[] = [];
  try {
    for (const { pageIndex, glyphIndices } of collectSlugRunPlans(layout, resource, fontSlot)) {
      const run = createSlugRun(layout, resource, pageIndex, glyphIndices, paint);
      runs.push(run);
      group.add(run.fillMesh);
    }
  } catch (error) {
    group.clear();
    for (const run of runs) run.geometry.dispose();
    throw error;
  }

  let disposed = false;
  const batch: SlugDrawBatch = {
    object: group,
    get glyphCount() {
      return runs.reduce((count, run) => count + run.logicalCount, 0);
    },
    get drawCount() {
      return runs.reduce((count, run) => count + (run.logicalCount === 0 ? 0 : 1), 0);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      batchContext.delete(batch);
      group.clear();
      for (const run of runs) run.geometry.dispose();
    },
  };
  batchContext.set(batch, { layout, resource, fontSlot, runs });
  return batch;
}

interface SlugRunPlan {
  readonly pageIndex: number;
  readonly glyphIndices: Uint32Array;
}

interface SlugRunValues {
  readonly floats: Float32Array;
  readonly uints: Uint32Array;
}

interface SlugBatchUpdate {
  commit(): void;
  dispose(): void;
}

function stageSlugBatchUpdate(
  batch: SlugDrawBatch,
  layout: ParagraphLayout,
  resource: SlugResource,
  fontSlot: number,
  paint: GlyphPaint,
): SlugBatchUpdate | undefined {
  const context = batchContext.get(batch);
  if (context === undefined || context.resource !== resource || context.fontSlot !== fontSlot) return undefined;
  if (context.layout === layout) return stageSlugPaintUpdate(context.runs, paint);
  const plans = collectSlugRunPlans(layout, resource, fontSlot);
  if (
    plans.length !== context.runs.length ||
    plans.some(({ pageIndex, glyphIndices }, index) => {
      const run = context.runs[index];
      return run === undefined || run.pageIndex !== pageIndex || glyphIndices.length > run.capacity;
    })
  ) {
    return undefined;
  }
  const staged = plans.map(({ glyphIndices }, index) =>
    stageSlugRunUpdate(context.runs[index]!, glyphIndices, slugRunValues(layout, resource, glyphIndices, paint)),
  );
  let disposed = false;
  return {
    commit() {
      if (disposed) return;
      disposed = true;
      for (const update of staged) update.commit();
      context.layout = layout;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const update of staged) update.dispose();
    },
  };
}

function collectSlugRunPlans(
  layout: ParagraphLayout,
  resource: SlugResource,
  fontSlot: number,
): readonly SlugRunPlan[] {
  const records = recordView(resource);
  const plans: SlugRunPlan[] = [];
  let pendingPage: number | undefined;
  let pendingGlyphs: number[] = [];
  const finishRun = (): void => {
    if (pendingPage === undefined || pendingGlyphs.length === 0) return;
    plans.push({ pageIndex: pendingPage, glyphIndices: Uint32Array.from(pendingGlyphs) });
    pendingGlyphs = [];
  };
  for (let glyphIndex = 0; glyphIndex < layout.glyphIds.length; glyphIndex += 1) {
    if (layout.glyphFontSlots[glyphIndex] !== fontSlot) continue;
    const glyphId = layout.glyphIds[glyphIndex]!;
    const pageIndex = records.getUint16(glyphId * SLUG_GLYPH_RECORD_STRIDE + 8, true);
    if (pageIndex === ABSENT_PAGE) continue;
    if (pendingPage !== undefined && pendingPage !== pageIndex) finishRun();
    pendingPage = pageIndex;
    pendingGlyphs.push(glyphIndex);
  }
  finishRun();
  return plans;
}

function slugRunValues(
  layout: ParagraphLayout,
  resource: SlugResource,
  glyphIndices: Uint32Array,
  paint: GlyphPaint,
): SlugRunValues {
  const floats = new Float32Array(glyphIndices.length * SLUG_FLOAT_INSTANCE_STRIDE);
  const uints = new Uint32Array(glyphIndices.length * SLUG_UINT_INSTANCE_STRIDE);
  const records = recordView(resource);
  for (let instance = 0; instance < glyphIndices.length; instance += 1) {
    const glyphIndex = glyphIndices[instance]!;
    const glyphId = layout.glyphIds[glyphIndex]!;
    const record = glyphId * SLUG_GLYPH_RECORD_STRIDE;
    const fontSize = layout.glyphFontSizes[glyphIndex]!;
    if (!Number.isFinite(fontSize) || fontSize <= 0) {
      throw new TypeError('Slug glyph font sizes must be positive finite values');
    }
    const scale = fontSize / resource.planeUnitsPerEm;
    const left = records.getInt16(record, true);
    const bottom = records.getInt16(record + 2, true);
    const right = records.getInt16(record + 4, true);
    const top = records.getInt16(record + 6, true);
    const horizontalBands = records.getUint16(record + 10, true);
    const verticalBands = records.getUint16(record + 12, true);
    const normalizedLeft = left / resource.planeUnitsPerEm;
    const normalizedBottom = bottom / resource.planeUnitsPerEm;
    const normalizedWidth = (right - left) / resource.planeUnitsPerEm;
    const normalizedHeight = (top - bottom) / resource.planeUnitsPerEm;
    setSlugValues(floats, SLUG_FLOAT_INSTANCE_STRIDE, instance, SLUG_FLOAT_INSTANCE_OFFSETS.origin, [
      layout.x[glyphIndex]! + left * scale,
      -layout.y[glyphIndex]! + bottom * scale,
    ]);
    setSlugValues(floats, SLUG_FLOAT_INSTANCE_STRIDE, instance, SLUG_FLOAT_INSTANCE_OFFSETS.size, [
      (right - left) * scale,
      (top - bottom) * scale,
    ]);
    setSlugValues(floats, SLUG_FLOAT_INSTANCE_STRIDE, instance, SLUG_FLOAT_INSTANCE_OFFSETS.emOrigin, [
      normalizedLeft,
      normalizedBottom,
    ]);
    setSlugValues(floats, SLUG_FLOAT_INSTANCE_STRIDE, instance, SLUG_FLOAT_INSTANCE_OFFSETS.emSize, [
      normalizedWidth,
      normalizedHeight,
    ]);
    setSlugValues(floats, SLUG_FLOAT_INSTANCE_STRIDE, instance, SLUG_FLOAT_INSTANCE_OFFSETS.inverseScale, [
      1 / fontSize,
    ]);
    const bandScaleX = verticalBands / normalizedWidth;
    const bandScaleY = horizontalBands / normalizedHeight;
    setSlugValues(floats, SLUG_FLOAT_INSTANCE_STRIDE, instance, SLUG_FLOAT_INSTANCE_OFFSETS.bandTransform, [
      bandScaleX,
      bandScaleY,
      -normalizedLeft * bandScaleX,
      -normalizedBottom * bandScaleY,
    ]);
    setSlugValues(
      floats,
      SLUG_FLOAT_INSTANCE_STRIDE,
      instance,
      SLUG_FLOAT_INSTANCE_OFFSETS.color,
      resolvedSlugPaint(paint, glyphIndex).color,
    );
    setSlugValues(uints, SLUG_UINT_INSTANCE_STRIDE, instance, SLUG_UINT_INSTANCE_OFFSETS.curveBase, [
      records.getUint32(record + 16, true),
    ]);
    setSlugValues(uints, SLUG_UINT_INSTANCE_STRIDE, instance, SLUG_UINT_INSTANCE_OFFSETS.horizontalHeaderBase, [
      records.getUint32(record + 24, true),
    ]);
    setSlugValues(uints, SLUG_UINT_INSTANCE_STRIDE, instance, SLUG_UINT_INSTANCE_OFFSETS.verticalHeaderBase, [
      records.getUint32(record + 28, true),
    ]);
    setSlugValues(uints, SLUG_UINT_INSTANCE_STRIDE, instance, SLUG_UINT_INSTANCE_OFFSETS.referenceBase, [
      records.getUint32(record + 32, true),
    ]);
    setSlugValues(uints, SLUG_UINT_INSTANCE_STRIDE, instance, SLUG_UINT_INSTANCE_OFFSETS.horizontalBandCount, [
      horizontalBands,
    ]);
    setSlugValues(uints, SLUG_UINT_INSTANCE_STRIDE, instance, SLUG_UINT_INSTANCE_OFFSETS.verticalBandCount, [
      verticalBands,
    ]);
  }
  return { floats, uints };
}

function stageSlugRunUpdate(run: SlugBatchRun, glyphIndices: Uint32Array, values: SlugRunValues): SlugBatchUpdate {
  const logicalCount = glyphIndices.length;
  const floatUpdate = stageSlugInterleavedData(run.floatData, values.floats, run.logicalCount, logicalCount);
  const uintUpdate = stageSlugInterleavedData(run.uintData, values.uints, run.logicalCount, logicalCount);
  let disposed = false;
  return {
    commit() {
      if (disposed) return;
      disposed = true;
      floatUpdate.commit();
      uintUpdate.commit();
      run.glyphIndices.set(glyphIndices);
      run.logicalCount = logicalCount;
      run.geometry.instanceCount = logicalCount;
      run.fillMesh.renderOrder = glyphIndices[0] ?? 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      floatUpdate.dispose();
      uintUpdate.dispose();
    },
  };
}

function stageSlugInterleavedData<Values extends Float32Array | Uint32Array>(
  data: THREE.InstancedInterleavedBuffer,
  values: Values,
  previousLogicalCount: number,
  logicalCount: number,
): SlugBatchUpdate {
  const liveValues = data.array as Values;
  const ranges = rasterInstanceUpdateRanges(
    liveValues,
    values,
    data.updateRanges,
    previousLogicalCount,
    logicalCount,
    data.stride,
  );
  let disposed = false;
  return {
    commit() {
      if (disposed) return;
      disposed = true;
      liveValues.set(values);
      if (ranges.length === 0) return;
      data.clearUpdateRanges();
      for (const range of ranges) data.addUpdateRange(range.start, range.count);
      data.needsUpdate = true;
    },
    dispose() {
      disposed = true;
    },
  };
}

function stageSlugPaintUpdate(runs: readonly SlugBatchRun[], paint: GlyphPaint): SlugBatchUpdate {
  const staged = runs.map((run) => {
    const colors = new Float32Array(run.logicalCount * 4);
    const liveFloats = run.floatData.array as Float32Array;
    const dirtyInstances = pendingRasterDirtyInstances(
      run.floatData.updateRanges,
      run.logicalCount,
      SLUG_FLOAT_INSTANCE_STRIDE,
    );
    for (let instance = 0; instance < run.logicalCount; instance += 1) {
      const color = resolvedSlugPaint(paint, run.glyphIndices[instance]!).color;
      colors.set(color, instance * 4);
      const liveStart = instance * SLUG_FLOAT_INSTANCE_STRIDE + SLUG_FLOAT_INSTANCE_OFFSETS.color;
      let changed = false;
      for (let component = 0; component < 4 && !changed; component += 1) {
        changed = color[component] !== liveFloats[liveStart + component];
      }
      if (changed) dirtyInstances.push(instance);
    }
    const ranges = coalesceRasterInstanceRanges(dirtyInstances, run.logicalCount, SLUG_FLOAT_INSTANCE_STRIDE);
    let disposed = false;
    return {
      commit() {
        if (disposed) return;
        disposed = true;
        for (let instance = 0; instance < run.logicalCount; instance += 1) {
          const colorStart = instance * 4;
          const liveStart = instance * SLUG_FLOAT_INSTANCE_STRIDE + SLUG_FLOAT_INSTANCE_OFFSETS.color;
          liveFloats[liveStart] = colors[colorStart]!;
          liveFloats[liveStart + 1] = colors[colorStart + 1]!;
          liveFloats[liveStart + 2] = colors[colorStart + 2]!;
          liveFloats[liveStart + 3] = colors[colorStart + 3]!;
        }
        if (ranges.length === 0) return;
        run.floatData.clearUpdateRanges();
        for (const range of ranges) run.floatData.addUpdateRange(range.start, range.count);
        run.floatData.needsUpdate = true;
      },
      dispose() {
        disposed = true;
      },
    } satisfies SlugBatchUpdate;
  });
  let disposed = false;
  return {
    commit() {
      if (disposed) return;
      disposed = true;
      for (const update of staged) update.commit();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const update of staged) update.dispose();
    },
  };
}

function setSlugValues(
  data: Float32Array | Uint32Array,
  stride: number,
  instance: number,
  offset: number,
  values: readonly number[],
): void {
  data.set(values, instance * stride + offset);
}

function createSlugRun(
  layout: ParagraphLayout,
  resource: SlugResource,
  pageIndex: number,
  glyphIndices: Uint32Array,
  paint: GlyphPaint,
): SlugBatchRun {
  const geometry = unitRasterQuadGeometry();
  try {
    return populateSlugRun(geometry, layout, resource, pageIndex, glyphIndices, paint);
  } catch (error) {
    geometry.dispose();
    throw error;
  }
}

function populateSlugRun(
  geometry: THREE.InstancedBufferGeometry,
  layout: ParagraphLayout,
  resource: SlugResource,
  pageIndex: number,
  glyphIndices: Uint32Array,
  paint: GlyphPaint,
): SlugBatchRun {
  const count = glyphIndices.length;
  const capacity = rasterInstanceCapacity(count);
  geometry.instanceCount = count;
  const floatData = new THREE.InstancedInterleavedBuffer(
    new Float32Array(capacity * SLUG_FLOAT_INSTANCE_STRIDE),
    SLUG_FLOAT_INSTANCE_STRIDE,
    1,
  ).setUsage(THREE.DynamicDrawUsage);
  const uintData = new THREE.InstancedInterleavedBuffer(
    new Uint32Array(capacity * SLUG_UINT_INSTANCE_STRIDE),
    SLUG_UINT_INSTANCE_STRIDE,
    1,
  ).setUsage(THREE.DynamicDrawUsage);
  const values = slugRunValues(layout, resource, glyphIndices, paint);
  (floatData.array as Float32Array).set(values.floats);
  (uintData.array as Uint32Array).set(values.uints);

  instanceAttribute(geometry, floatData, 'slugOrigin', 2, SLUG_FLOAT_INSTANCE_OFFSETS.origin);
  instanceAttribute(geometry, floatData, 'slugSize', 2, SLUG_FLOAT_INSTANCE_OFFSETS.size);
  instanceAttribute(geometry, floatData, 'slugEmOrigin', 2, SLUG_FLOAT_INSTANCE_OFFSETS.emOrigin);
  instanceAttribute(geometry, floatData, 'slugEmSize', 2, SLUG_FLOAT_INSTANCE_OFFSETS.emSize);
  instanceAttribute(geometry, floatData, 'slugInverseScale', 1, SLUG_FLOAT_INSTANCE_OFFSETS.inverseScale);
  instanceAttribute(geometry, floatData, 'slugBandTransform', 4, SLUG_FLOAT_INSTANCE_OFFSETS.bandTransform);
  instanceAttribute(geometry, uintData, 'slugCurveBase', 1, SLUG_UINT_INSTANCE_OFFSETS.curveBase);
  instanceAttribute(geometry, uintData, 'slugHorizontalHeaderBase', 1, SLUG_UINT_INSTANCE_OFFSETS.horizontalHeaderBase);
  instanceAttribute(geometry, uintData, 'slugVerticalHeaderBase', 1, SLUG_UINT_INSTANCE_OFFSETS.verticalHeaderBase);
  instanceAttribute(geometry, uintData, 'slugReferenceBase', 1, SLUG_UINT_INSTANCE_OFFSETS.referenceBase);
  instanceAttribute(geometry, uintData, 'slugHorizontalBandCount', 1, SLUG_UINT_INSTANCE_OFFSETS.horizontalBandCount);
  instanceAttribute(geometry, uintData, 'slugVerticalBandCount', 1, SLUG_UINT_INSTANCE_OFFSETS.verticalBandCount);
  instanceAttribute(geometry, floatData, 'slugColor', 4, SLUG_FLOAT_INSTANCE_OFFSETS.color);

  const page = resource.pages[pageIndex]!;
  const initialState = slugMaterialState(page);
  const fillMesh = new THREE.Mesh(geometry, initialState.material);
  fillMesh.frustumCulled = false;
  fillMesh.renderOrder = glyphIndices[0] ?? 0;
  const retainedGlyphIndices = new Uint32Array(capacity);
  retainedGlyphIndices.set(glyphIndices);
  const run: SlugBatchRun = {
    capacity,
    glyphIndices: retainedGlyphIndices,
    logicalCount: count,
    floatData,
    uintData,
    geometry,
    fillMesh,
    materialState: initialState,
    pageIndex,
  };
  fillMesh.onBeforeRender = (renderer, _scene, camera): void => {
    renderer.getDrawingBufferSize(drawingBufferSize);
    run.materialState.viewport.value.copy(drawingBufferSize);
    updateMvpUniforms(run.materialState, fillMesh, camera);
  };
  return run;
}

function instanceAttribute(
  geometry: THREE.InstancedBufferGeometry,
  data: THREE.InstancedInterleavedBuffer,
  name: string,
  itemSize: number,
  offset: number,
): THREE.InterleavedBufferAttribute {
  const bufferAttribute = new THREE.InterleavedBufferAttribute(data, itemSize, offset, false);
  geometry.setAttribute(name, bufferAttribute);
  return bufferAttribute;
}

function resolvedSlugPaint(paint: GlyphPaint, glyphIndex: number): ResolvedPaint {
  const paintIndex = paint.paintIndices[glyphIndex];
  const resolved = paintIndex === undefined ? undefined : paint.palette[paintIndex];
  if (resolved === undefined) throw new TypeError('glyph paint references a missing palette entry');
  return resolved;
}

function assertSlugGlyphInputs(
  layout: ParagraphLayout,
  resource: SlugResource,
  fontSlot: number,
  paint: GlyphPaint,
): void {
  const records = recordView(resource);
  const recordCount = resource.records.byteLength / SLUG_GLYPH_RECORD_STRIDE;
  const glyphIndices: number[] = [];
  for (let glyphIndex = 0; glyphIndex < layout.glyphIds.length; glyphIndex += 1) {
    if (layout.glyphFontSlots[glyphIndex] !== fontSlot) continue;
    const glyphId = layout.glyphIds[glyphIndex];
    if (glyphId === undefined || glyphId >= recordCount) {
      throw new TypeError('paragraph layout references a Slug glyph outside the registered font');
    }
    const pageIndex = records.getUint16(glyphId * SLUG_GLYPH_RECORD_STRIDE + 8, true);
    if (pageIndex !== ABSENT_PAGE && resource.pages[pageIndex] === undefined) {
      throw new TypeError('Slug batch references a missing page');
    }
    glyphIndices.push(glyphIndex);
  }
  assertSlugRunPaint(glyphIndices, paint);
}

function assertSlugRunPaint(glyphIndices: ArrayLike<number>, paint: GlyphPaint): void {
  for (let instance = 0; instance < glyphIndices.length; instance += 1) {
    const glyphIndex = glyphIndices[instance]!;
    resolvedSlugPaint(paint, glyphIndex);
  }
}

function slugMaterialState(page: SlugPageResource): SlugMaterialState {
  const existing = materialStateByCurveTexture.get(page.curveTexture);
  if (existing !== undefined) return existing;
  const material = new THREE.MeshBasicNodeMaterial({
    blending: THREE.NormalBlending,
    depthTest: false,
    depthWrite: false,
    side: THREE.FrontSide,
    transparent: true,
  });
  const viewport: UniformNode<'vec2', THREE.Vector2> = uniform(new THREE.Vector2(1, 1));
  const mvpRow0: UniformNode<'vec4', THREE.Vector4> = uniform(new THREE.Vector4(1, 0, 0, 0));
  const mvpRow1: UniformNode<'vec4', THREE.Vector4> = uniform(new THREE.Vector4(0, 1, 0, 0));
  const mvpRow3: UniformNode<'vec4', THREE.Vector4> = uniform(new THREE.Vector4(0, 0, 0, 1));
  const renderCoordinate = varyingProperty('vec2', 'slugRenderCoordinate');
  const origin: Node<'vec2'> = attribute<'vec2'>('slugOrigin', 'vec2');
  const size: Node<'vec2'> = attribute<'vec2'>('slugSize', 'vec2');
  const emOrigin: Node<'vec2'> = attribute<'vec2'>('slugEmOrigin', 'vec2');
  const emSize: Node<'vec2'> = attribute<'vec2'>('slugEmSize', 'vec2');
  const inverseScale: Node<'float'> = attribute<'float'>('slugInverseScale', 'float');
  const bandTransform: Node<'vec4'> = attribute<'vec4'>('slugBandTransform', 'vec4');
  const curveBaseTexel: Node<'uint'> = attribute<'uint'>('slugCurveBase', 'uint');
  const horizontalHeaderBase: Node<'uint'> = attribute<'uint'>('slugHorizontalHeaderBase', 'uint');
  const verticalHeaderBase: Node<'uint'> = attribute<'uint'>('slugVerticalHeaderBase', 'uint');
  const referenceBase: Node<'uint'> = attribute<'uint'>('slugReferenceBase', 'uint');
  const horizontalBandCount: Node<'uint'> = attribute<'uint'>('slugHorizontalBandCount', 'uint');
  const verticalBandCount: Node<'uint'> = attribute<'uint'>('slugVerticalBandCount', 'uint');
  const color: Node<'vec4'> = attribute<'vec4'>('slugColor', 'vec4');

  material.positionNode = Fn(() => {
    const localPosition = vec2(
      add(origin.x, mul(positionLocal.x, size.x)),
      add(origin.y, mul(positionLocal.y, size.y)),
    );
    const outwardNormal = vec2(mul(sub(positionLocal.x, 0.5), size.x), mul(sub(positionLocal.y, 0.5), size.y));
    const emCoordinate = vec2(
      add(emOrigin.x, mul(positionLocal.x, emSize.x)),
      add(emOrigin.y, mul(positionLocal.y, emSize.y)),
    );
    const dilated = slugDilate(
      localPosition,
      outwardNormal,
      emCoordinate,
      inverseScale,
      mvpRow0,
      mvpRow1,
      mvpRow3,
      viewport,
    );
    renderCoordinate.assign(dilated.textureCoordinate);
    return vec3(dilated.position.x, dilated.position.y, 0);
  })();
  material.colorNode = color.rgb;
  material.opacityNode = Fn(() => {
    const coverage = slugRender(
      page,
      {
        curveBaseTexel,
        horizontalHeaderBase,
        verticalHeaderBase,
        referenceBase,
        horizontalBandCount,
        verticalBandCount,
        bandTransform,
      },
      renderCoordinate,
      { evenOdd: bool(false), weightBoost: bool(false) },
    );
    return mul(color.a, coverage);
  })();

  const state = { material, viewport, mvpRow0, mvpRow1, mvpRow3 };
  materialStateByCurveTexture.set(page.curveTexture, state);
  return state;
}

function updateMvpUniforms(state: SlugMaterialState, object: THREE.Object3D, camera: THREE.Camera): void {
  modelViewProjectionMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  modelViewProjectionMatrix.multiply(object.matrixWorld);
  const values = modelViewProjectionMatrix.elements;
  state.mvpRow0.value.set(values[0]!, values[4]!, values[8]!, values[12]!);
  state.mvpRow1.value.set(values[1]!, values[5]!, values[9]!, values[13]!);
  state.mvpRow3.value.set(values[3]!, values[7]!, values[11]!, values[15]!);
}

function assertSlugPaint(paint: GlyphPaint): void {
  for (const entry of paint.palette) {
    assertSlugColor(entry.color, 'Slug fill');
    if (entry.outline !== undefined) {
      throw new TypeError('Slug V0 does not support outline paint');
    }
    if (entry.shadow !== undefined) {
      throw new TypeError('Slug V0 does not support shadow paint');
    }
  }
}

function assertSlugColor(color: readonly number[], label: string): void {
  if (color.length !== 4 || color.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new TypeError(`${label} color must contain four finite linear values in [0, 1]`);
  }
}

function disposeSlugResource(resource: SlugResource): void {
  for (const page of resource.pages) disposeSlugPage(page);
}

function disposeSlugPage(page: SlugPageResource): void {
  const state = materialStateByCurveTexture.get(page.curveTexture);
  state?.material.dispose();
  materialStateByCurveTexture.delete(page.curveTexture);
  page.curveTexture.dispose();
  page.headerTexture.dispose();
  page.referenceTexture.dispose();
}

function recordView(resource: SlugResource): DataView {
  return new DataView(resource.records.buffer, resource.records.byteOffset, resource.records.byteLength);
}

function textureDimension(value: JsonValue | undefined, path: string): number {
  const dimension = positiveSafeInteger(value, path);
  if (dimension > MAX_TEXTURE_DIMENSION) throw new RangeError(`${path} exceeds 16384`);
  return dimension;
}

function boundedCount(value: JsonValue | undefined, capacity: number, path: string): number {
  const count = nonnegativeSafeInteger(value, path);
  if (count > capacity) throw new RangeError(`${path} exceeds its texture capacity`);
  return count;
}

function assertGridLength(bytes: Uint8Array, texels: number, bytesPerTexel: number, path: string): void {
  if (bytes.byteLength !== checkedProduct(texels, bytesPerTexel, path)) {
    throw new TypeError(`${path} byte length does not match its dimensions`);
  }
}

function checkedProduct(left: number, right: number, path: string): number {
  const product = left * right;
  if (!Number.isSafeInteger(product)) throw new RangeError(`${path} exceeds safe integer range`);
  return product;
}

function checkedGpuBytes(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total) || total > MAX_RUNTIME_GPU_BYTES) {
    throw new RangeError('Slug pages exceed the runtime GPU-memory limit');
  }
  return total;
}

function ownedUint16(bytes: Uint8Array): Uint16Array {
  const copy = bytes.slice();
  return new Uint16Array(copy.buffer, copy.byteOffset, copy.byteLength / 2);
}

function ownedUint32(bytes: Uint8Array): Uint32Array {
  const copy = bytes.slice();
  return new Uint32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}
