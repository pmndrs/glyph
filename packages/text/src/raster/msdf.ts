import {
  KHR_DF_CHANNEL_RGBSDA_ALPHA,
  KHR_DF_CHANNEL_RGBSDA_BLUE,
  KHR_DF_CHANNEL_RGBSDA_GREEN,
  KHR_DF_CHANNEL_RGBSDA_RED,
  VK_FORMAT_R8G8B8A8_UNORM,
} from 'ktx-parse';
import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  add,
  attribute as tslAttribute,
  clamp,
  div,
  fwidth,
  int,
  max,
  min,
  mul,
  positionLocal,
  step,
  sub,
  texture,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import type { RegisteredFont } from '../font.js';
import {
  MSDF_EXTENSION,
  MSDF_FORMAT_VERSION,
  MSDF_KIND,
  MTSDF_MAX_EM_SIZE,
  MTSDF_MAX_PIXEL_RANGE,
  msdfDescriptor,
  msdfRasterKey,
  type MsdfOptions,
} from '../internal/msdf-contract.js';
import {
  ABSENT_GLYPH_PAGE,
  DENSE_GLYPH_RECORD_STRIDE,
  decodeEmbeddedLosslessAtlasPage,
  jsonArray,
  jsonObject,
  nonnegativeSafeInteger,
  validateDenseGlyphRecords,
  type RasterAtlasPage,
} from '../internal/raster-atlas.js';
import {
  assertParallelRasterLayout,
  assertParallelRasterPaint,
  rasterRenderOrder,
  unitRasterQuadGeometry,
} from '../internal/raster-batch.js';
import { rasterInstanceCapacity, rasterInstanceUpdateRanges } from '../internal/raster-instance-capacity.js';
import type { ParagraphLayout } from '../layout.js';
import type { GlyphPaint, ResolvedPaint } from '../paint.js';
import {
  defineRaster,
  defineRasterBatchStage,
  type JsonValue,
  type RasterModule,
  type RasterObjectDrawBatch,
  type RegisteredRaster,
} from '../raster.js';
import { assertRasterCoverage, decodeRasterCoverage } from '../internal/raster-coverage-artifact.js';

export {
  MSDF_EXTENSION,
  MSDF_FORMAT_VERSION,
  MSDF_GENERATOR_VERSION,
  MSDF_KIND,
  MTSDF_EM_SIZE,
  MTSDF_MAX_EM_SIZE,
  MTSDF_MAX_OUTLINE_ATLAS_PIXELS,
  MTSDF_MAX_PIXEL_RANGE,
  MTSDF_PIXEL_RANGE,
  MTSDF_PLANE_UNITS_PER_EM,
  msdfDescriptor,
  msdfDescriptorRasterKey,
  msdfRasterKey,
  type MsdfConfiguration,
  type MsdfDescriptorV0,
  type MsdfOptions,
} from '../internal/msdf-contract.js';

const MAX_RUNTIME_GPU_BYTES = 256 * 1024 * 1024;
const RECORD_STRIDE = DENSE_GLYPH_RECORD_STRIDE;
const ABSENT_PAGE = ABSENT_GLYPH_PAGE;

export interface MsdfPageResource {
  readonly width: number;
  readonly height: number;
}

export interface MsdfAtlasResource {
  readonly width: number;
  readonly height: number;
  readonly layers: number;
  readonly texture: THREE.DataArrayTexture;
}

export interface MsdfResource {
  readonly emSize: number;
  readonly pixelRange: number;
  readonly planeUnitsPerEm: number;
  readonly records: Uint8Array;
  readonly coverage?: Uint8Array;
  readonly pages: readonly MsdfPageResource[];
  readonly atlas: MsdfAtlasResource;
  /** Exact padded base-level texture-array bytes. */
  readonly gpuBytes: number;
}

interface MsdfBatchRun {
  readonly capacity: number;
  glyphIndices: Uint32Array;
  logicalCount: number;
  readonly instanceData: THREE.InstancedInterleavedBuffer;
  readonly paintStructure: Float64Array;
  readonly geometry: THREE.InstancedBufferGeometry;
  readonly mesh: THREE.Mesh;
}

export interface MsdfDrawBatch extends RasterObjectDrawBatch<THREE.Object3D> {
  readonly glyphCount: number;
  readonly drawCount: number;
  dispose(): void;
}

interface MsdfMaterialState {
  readonly material: THREE.MeshBasicNodeMaterial;
}

const materialByAtlasTexture = new WeakMap<THREE.DataArrayTexture, MsdfMaterialState>();
interface MsdfBatchContext {
  layout: ParagraphLayout;
  readonly resource: MsdfResource;
  readonly fontSlot: number;
  readonly run: MsdfBatchRun | undefined;
  renderOrderBase: number;
}

const batchContext = new WeakMap<MsdfDrawBatch, MsdfBatchContext>();

const INSTANCE_STRIDE = 28;
const INSTANCE_OFFSETS = {
  origin: 0,
  size: 2,
  uvOrigin: 4,
  uvSize: 6,
  uvBounds: 8,
  shadowOffset: 12,
  fillColor: 14,
  outlineColor: 18,
  outlineWidth: 22,
  shadowColor: 23,
  pageIndex: 27,
} as const;
const PAINT_STRUCTURE_STRIDE = 3;

const msdfModule: RasterModule<typeof MSDF_KIND, MsdfResource, MsdfDrawBatch, MsdfOptions | undefined> = defineRaster({
  kind: MSDF_KIND,
  extension: MSDF_EXTENSION,
  version: MSDF_FORMAT_VERSION,
  runtimeBaker: () => import('../runtime-bakers/msdf.js'),
  descriptor: msdfDescriptor,
  async decode(font, raster, signal) {
    signal?.throwIfAborted();
    const resource = await decodeMsdfResource(font, raster);
    signal?.throwIfAborted();
    return resource;
  },
  prepare(layout, resource, fontSlot, signal) {
    signal?.throwIfAborted();
    assertRasterCoverage(layout, fontSlot, resource.coverage, MSDF_KIND);
  },
  stageBatch(previous, layout, resource, fontSlot, paint) {
    const context = previous === undefined ? undefined : batchContext.get(previous);
    if (previous !== undefined && context?.resource === resource && context.fontSlot === fontSlot) {
      const update =
        context.layout === layout && sameMsdfPaintStructure(context.run, paint)
          ? stageMsdfPaintUpdate(context.layout, context.run, paint, context.renderOrderBase)
          : stageMsdfBatchUpdate(context, layout, resource, fontSlot, paint);
      if (update !== undefined) return defineRasterBatchStage(previous, update.commit, update.dispose);
    }
    const batch = buildMsdfBatches(layout, resource, fontSlot, paint);
    return defineRasterBatchStage(
      batch,
      () => undefined,
      () => batch.dispose(),
    );
  },
  validatePaint: assertMsdfPaint,
  dispose(resource) {
    disposeMsdfResource(resource);
  },
});

export type MsdfModule = typeof msdfModule;

/** Configurable MTSDF raster module for `defineFont(source, msdf)`. */
export const msdf: MsdfModule = msdfModule;

async function decodeMsdfResource(font: RegisteredFont, raster: RegisteredRaster): Promise<MsdfResource> {
  if (
    raster.font !== font.handle ||
    raster.kind !== MSDF_KIND ||
    raster.extension !== MSDF_EXTENSION ||
    raster.version !== MSDF_FORMAT_VERSION
  ) {
    throw new TypeError('MTSDF raster is not bound to the supplied font');
  }
  const extension = jsonObject(raster.extensionData, 'MTSDF extension');
  if (
    extension.version !== MSDF_FORMAT_VERSION ||
    extension.rasterKey !== raster.rasterKey ||
    extension.shapingHash !== font.shapingHash ||
    extension.glyphCount !== font.glyphCount ||
    extension.glyphIdWidth !== 16 ||
    extension.encoding !== 'mtsdf' ||
    extension.recordStride !== RECORD_STRIDE
  ) {
    throw new TypeError('MTSDF extension does not match the runtime contract');
  }
  const emSize = configuredInteger(extension.emSize, 'MTSDF emSize', MTSDF_MAX_EM_SIZE);
  const pixelRange = configuredInteger(extension.pixelRange, 'MTSDF pixelRange', MTSDF_MAX_PIXEL_RANGE);
  const planeUnitsPerEm = configuredInteger(extension.planeUnitsPerEm, 'MTSDF planeUnitsPerEm', MTSDF_MAX_EM_SIZE);
  if (planeUnitsPerEm !== emSize) {
    throw new TypeError('MTSDF planeUnitsPerEm must equal emSize');
  }
  const coverage = decodeRasterCoverage(extension, font.glyphCount, (view) => raster.view(view), 'MTSDF');
  if (
    raster.rasterKey !==
    (await msdfRasterKey({
      emSize,
      pixelRange,
      ...(coverage === undefined ? {} : { coverage: coverage.descriptor }),
    }))
  ) {
    throw new TypeError('MTSDF raster key does not match its generation policy');
  }
  const records = raster.view(nonnegativeSafeInteger(extension.recordBufferView, 'MTSDF recordBufferView'));
  if (records.byteLength !== font.glyphCount * RECORD_STRIDE) {
    throw new TypeError('MTSDF record table does not match the registered glyph count');
  }
  const pageValues = jsonArray(extension.pages, 'MTSDF pages');
  if (pageValues.length === 0) throw new TypeError('MTSDF raster must contain at least one page');
  if (pageValues.length > 65_535) throw new RangeError('MTSDF raster contains too many pages');
  const decodedPages: RasterAtlasPage[] = [];
  try {
    for (let pageIndex = 0; pageIndex < pageValues.length; pageIndex += 1) {
      validateMtsdfPageDirectory(pageValues[pageIndex]!, pageIndex);
      const page = decodeEmbeddedLosslessAtlasPage(raster, pageValues[pageIndex]!, `MTSDF page ${pageIndex}`, {
        gpuFormat: 'rgba8unorm',
        vkFormat: VK_FORMAT_R8G8B8A8_UNORM,
        blockWidth: 1,
        blockHeight: 1,
        bytesPerBlock: 4,
        uncompressedChannelTypes: [
          KHR_DF_CHANNEL_RGBSDA_RED,
          KHR_DF_CHANNEL_RGBSDA_GREEN,
          KHR_DF_CHANNEL_RGBSDA_BLUE,
          KHR_DF_CHANNEL_RGBSDA_ALPHA,
        ],
        textureFormat: THREE.RGBAFormat,
        generateMipmaps: false,
        minFilter: THREE.LinearFilter,
      });
      decodedPages.push(page);
    }
    validateDenseGlyphRecords(records, decodedPages, 'MTSDF', true);
    const { atlas, gpuBytes, pages } = createTextureArray(decodedPages);
    return {
      emSize,
      pixelRange,
      planeUnitsPerEm,
      records,
      ...(coverage === undefined ? {} : { coverage: coverage.bits }),
      pages,
      atlas,
      gpuBytes,
    };
  } finally {
    for (const page of decodedPages) page.texture.dispose();
  }
}

function configuredInteger(value: JsonValue | undefined, label: string, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${label} must be an integer in 1..=${maximum}`);
  }
  return value;
}

function validateMtsdfPageDirectory(value: JsonValue, pageIndex: number): void {
  const page = jsonObject(value, `MTSDF page ${pageIndex}`);
  const variants = jsonArray(page.variants, `MTSDF page ${pageIndex} variants`);
  if (variants.length !== 1) {
    throw new TypeError('MTSDF V0 pages must contain exactly one lossless RGBA8 variant');
  }
  const variant = jsonObject(variants[0], `MTSDF page ${pageIndex} variant`);
  if (variant.gpuFormat !== 'rgba8unorm') {
    throw new TypeError('MTSDF V0 pages accept only the lossless rgba8unorm baseline');
  }
}

function createTextureArray(pages: readonly RasterAtlasPage[]): {
  readonly atlas: MsdfAtlasResource;
  readonly gpuBytes: number;
  readonly pages: readonly MsdfPageResource[];
} {
  const width = Math.max(...pages.map((page) => page.width));
  const height = Math.max(...pages.map((page) => page.height));
  const baseBytes = width * height * pages.length * 4;
  if (!Number.isSafeInteger(baseBytes) || baseBytes > MAX_RUNTIME_GPU_BYTES) {
    throw new RangeError('MTSDF pages exceed the runtime GPU-memory limit');
  }
  const texels = new Uint8Array(baseBytes);
  for (let layer = 0; layer < pages.length; layer += 1) {
    const page = pages[layer]!;
    const source = page.texture.image.data;
    if (!(source instanceof Uint8Array)) {
      throw new TypeError(`MTSDF page ${layer} is not backed by unsigned-byte RGBA texels`);
    }
    const sourceRowBytes = page.width * 4;
    const targetRowBytes = width * 4;
    for (let row = 0; row < page.height; row += 1) {
      const sourceOffset = row * sourceRowBytes;
      const targetRow = height - row - 1;
      const targetOffset = (layer * height + targetRow) * targetRowBytes;
      texels.set(source.subarray(sourceOffset, sourceOffset + sourceRowBytes), targetOffset);
    }
  }
  const atlasTexture = new THREE.DataArrayTexture(texels, width, height, pages.length);
  atlasTexture.colorSpace = THREE.NoColorSpace;
  atlasTexture.generateMipmaps = false;
  atlasTexture.minFilter = THREE.LinearFilter;
  atlasTexture.magFilter = THREE.LinearFilter;
  atlasTexture.needsUpdate = true;
  return {
    atlas: { width, height, layers: pages.length, texture: atlasTexture },
    gpuBytes: baseBytes,
    pages: pages.map(({ width: pageWidth, height: pageHeight }) => ({
      width: pageWidth,
      height: pageHeight,
    })),
  };
}

function disposeMsdfResource(resource: MsdfResource): void {
  const atlasTexture = resource.atlas.texture;
  const state = materialByAtlasTexture.get(atlasTexture);
  state?.material.dispose();
  materialByAtlasTexture.delete(atlasTexture);
  atlasTexture.dispose();
}

function buildMsdfBatches(
  layout: ParagraphLayout,
  resource: MsdfResource,
  fontSlot: number,
  paint: GlyphPaint,
): MsdfDrawBatch {
  assertParallelRasterLayout(layout, paint);
  assertRasterCoverage(layout, fontSlot, resource.coverage, MSDF_KIND);
  assertMsdfPaint(paint);
  const group = new THREE.Object3D();
  const glyphIndices = collectMsdfGlyphIndices(layout, resource, fontSlot);
  const run = glyphIndices.length === 0 ? undefined : createMsdfRun(layout, resource, glyphIndices, paint);
  if (run !== undefined) group.add(run.mesh);

  let disposed = false;
  const batch: MsdfDrawBatch = {
    object: group,
    get glyphCount() {
      return run?.logicalCount ?? 0;
    },
    get drawCount() {
      return run === undefined || run.logicalCount === 0 ? 0 : 1;
    },
    setRenderOrderBase(base) {
      const context = batchContext.get(batch);
      if (context === undefined) return;
      context.renderOrderBase = base;
      if (run !== undefined) run.mesh.renderOrder = rasterRenderOrder(base, run.glyphIndices);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      batchContext.delete(batch);
      group.clear();
      run?.geometry.dispose();
    },
  };
  batchContext.set(batch, { layout, resource, fontSlot, run, renderOrderBase: 0 });
  return batch;
}

function createMsdfRun(
  layout: ParagraphLayout,
  resource: MsdfResource,
  glyphIndices: Uint32Array,
  paint: GlyphPaint,
): MsdfBatchRun {
  const count = glyphIndices.length;
  const capacity = rasterInstanceCapacity(count);
  const geometry = unitRasterQuadGeometry();
  geometry.instanceCount = count;
  const instanceData = new THREE.InstancedInterleavedBuffer(
    new Float32Array(capacity * INSTANCE_STRIDE),
    INSTANCE_STRIDE,
    1,
  ).setUsage(THREE.DynamicDrawUsage);
  instanceAttribute(geometry, instanceData, 'msdfOrigin', 2, INSTANCE_OFFSETS.origin);
  instanceAttribute(geometry, instanceData, 'msdfSize', 2, INSTANCE_OFFSETS.size);
  instanceAttribute(geometry, instanceData, 'msdfUvOrigin', 2, INSTANCE_OFFSETS.uvOrigin);
  instanceAttribute(geometry, instanceData, 'msdfUvSize', 2, INSTANCE_OFFSETS.uvSize);
  instanceAttribute(geometry, instanceData, 'msdfUvBounds', 4, INSTANCE_OFFSETS.uvBounds);
  instanceAttribute(geometry, instanceData, 'msdfShadowOffset', 2, INSTANCE_OFFSETS.shadowOffset);
  instanceAttribute(geometry, instanceData, 'msdfFillColor', 4, INSTANCE_OFFSETS.fillColor);
  instanceAttribute(geometry, instanceData, 'msdfOutlineColor', 4, INSTANCE_OFFSETS.outlineColor);
  instanceAttribute(geometry, instanceData, 'msdfOutlineWidth', 1, INSTANCE_OFFSETS.outlineWidth);
  instanceAttribute(geometry, instanceData, 'msdfShadowColor', 4, INSTANCE_OFFSETS.shadowColor);
  instanceAttribute(geometry, instanceData, 'msdfPageIndex', 1, INSTANCE_OFFSETS.pageIndex);
  const mesh = new THREE.Mesh(geometry, msdfMaterial(resource.atlas, resource.pixelRange));
  mesh.frustumCulled = false;
  mesh.renderOrder = rasterRenderOrder(0, glyphIndices);
  const run: MsdfBatchRun = {
    capacity,
    glyphIndices: new Uint32Array(capacity),
    logicalCount: count,
    instanceData,
    paintStructure: new Float64Array(capacity * PAINT_STRUCTURE_STRIDE),
    geometry,
    mesh,
  };
  run.glyphIndices.set(glyphIndices);
  writeMsdfInstances(layout, resource, run.instanceData.array as Float32Array, glyphIndices, paint, run.paintStructure);
  run.instanceData.needsUpdate = true;
  return run;
}

function instanceAttribute(
  geometry: THREE.InstancedBufferGeometry,
  data: THREE.InstancedInterleavedBuffer,
  name: string,
  itemSize: number,
  offset: number,
): THREE.InterleavedBufferAttribute {
  const attribute = new THREE.InterleavedBufferAttribute(data, itemSize, offset, false);
  geometry.setAttribute(name, attribute);
  return attribute;
}

function writeMsdfInstances(
  layout: ParagraphLayout,
  resource: MsdfResource,
  values: Float32Array,
  glyphIndices: Uint32Array,
  paint: GlyphPaint,
  paintStructure?: Float64Array,
): void {
  const records = new DataView(resource.records.buffer, resource.records.byteOffset, resource.records.byteLength);
  for (let instance = 0; instance < glyphIndices.length; instance += 1) {
    const glyphIndex = glyphIndices[instance]!;
    const paintEntry = resolvedPaint(paint, glyphIndex);
    writeMsdfInstance(layout, resource, values, records, instance, glyphIndex, paintEntry, paintStructure);
  }
}

function collectMsdfGlyphIndices(layout: ParagraphLayout, resource: MsdfResource, fontSlot: number): Uint32Array {
  const records = new DataView(resource.records.buffer, resource.records.byteOffset, resource.records.byteLength);
  let count = 0;
  for (let glyphIndex = 0; glyphIndex < layout.glyphIds.length; glyphIndex += 1) {
    if (layout.glyphFontSlots[glyphIndex] !== fontSlot) continue;
    const glyphId = layout.glyphIds[glyphIndex];
    if (glyphId === undefined || glyphId >= resource.records.byteLength / RECORD_STRIDE) {
      throw new TypeError('paragraph layout references an MTSDF glyph outside the registered font');
    }
    const pageIndex = records.getUint16(glyphId * RECORD_STRIDE + 16, true);
    if (pageIndex === ABSENT_PAGE) continue;
    if (resource.pages[pageIndex] === undefined) throw new TypeError('MTSDF batch references a missing page');
    count += 1;
  }
  const glyphIndices = new Uint32Array(count);
  let instance = 0;
  for (let glyphIndex = 0; glyphIndex < layout.glyphIds.length; glyphIndex += 1) {
    if (layout.glyphFontSlots[glyphIndex] !== fontSlot) continue;
    const glyphId = layout.glyphIds[glyphIndex]!;
    const pageIndex = records.getUint16(glyphId * RECORD_STRIDE + 16, true);
    if (pageIndex !== ABSENT_PAGE) glyphIndices[instance++] = glyphIndex;
  }
  return glyphIndices;
}

interface MsdfBatchUpdate {
  commit(): void;
  dispose(): void;
}

function stageMsdfBatchUpdate(
  context: MsdfBatchContext,
  layout: ParagraphLayout,
  resource: MsdfResource,
  fontSlot: number,
  paint: GlyphPaint,
): MsdfBatchUpdate | undefined {
  assertParallelRasterLayout(layout, paint);
  assertRasterCoverage(layout, fontSlot, resource.coverage, MSDF_KIND);
  assertMsdfPaint(paint);
  const glyphIndices = collectMsdfGlyphIndices(layout, resource, fontSlot);
  const run = context.run;
  if (run === undefined) {
    if (glyphIndices.length !== 0) return undefined;
    let disposed = false;
    return {
      commit() {
        if (disposed) return;
        disposed = true;
        context.layout = layout;
      },
      dispose() {
        disposed = true;
      },
    };
  }
  if (glyphIndices.length > run.capacity) return undefined;

  const values = new Float32Array(glyphIndices.length * INSTANCE_STRIDE);
  const paintStructure = new Float64Array(glyphIndices.length * PAINT_STRUCTURE_STRIDE);
  writeMsdfInstances(layout, resource, values, glyphIndices, paint, paintStructure);
  const liveValues = run.instanceData.array as Float32Array;
  return stageMsdfRunCommit(run, liveValues, values, glyphIndices, context.renderOrderBase, () => {
    run.paintStructure.set(paintStructure);
    context.layout = layout;
  });
}

function stageMsdfPaintUpdate(
  layout: ParagraphLayout,
  run: MsdfBatchRun | undefined,
  paint: GlyphPaint,
  renderOrderBase: number,
): MsdfBatchUpdate {
  assertParallelRasterPaint(layout, paint);
  assertMsdfPaint(paint);
  if (run === undefined) return noOpMsdfBatchUpdate;
  const logicalLength = run.logicalCount * INSTANCE_STRIDE;
  const values = new Float32Array((run.instanceData.array as Float32Array).subarray(0, logicalLength));
  for (let instance = 0; instance < run.logicalCount; instance += 1) {
    const glyphIndex = run.glyphIndices[instance]!;
    const entry = resolvedPaint(paint, glyphIndex);
    const offset = instance * INSTANCE_STRIDE;
    values.set(entry.color, offset + INSTANCE_OFFSETS.fillColor);
    values.set(entry.outline?.color ?? TRANSPARENT_LINEAR_RGBA, offset + INSTANCE_OFFSETS.outlineColor);
    values.set(entry.shadow?.color ?? TRANSPARENT_LINEAR_RGBA, offset + INSTANCE_OFFSETS.shadowColor);
  }
  return stageMsdfRunCommit(
    run,
    run.instanceData.array as Float32Array,
    values,
    run.glyphIndices.subarray(0, run.logicalCount),
    renderOrderBase,
    () => undefined,
  );
}

function stageMsdfRunCommit(
  run: MsdfBatchRun,
  liveValues: Float32Array,
  values: Float32Array,
  glyphIndices: Uint32Array,
  renderOrderBase: number,
  beforeCommit: () => void,
): MsdfBatchUpdate {
  const logicalCount = glyphIndices.length;
  const ranges = rasterInstanceUpdateRanges(
    liveValues,
    values,
    run.instanceData.updateRanges,
    run.logicalCount,
    logicalCount,
    INSTANCE_STRIDE,
  );
  let disposed = false;
  return {
    commit() {
      if (disposed) return;
      disposed = true;
      beforeCommit();
      liveValues.set(values);
      run.glyphIndices.set(glyphIndices);
      run.logicalCount = logicalCount;
      run.geometry.instanceCount = logicalCount;
      run.mesh.renderOrder = rasterRenderOrder(renderOrderBase, glyphIndices);
      if (ranges.length === 0) return;
      run.instanceData.clearUpdateRanges();
      for (const range of ranges) run.instanceData.addUpdateRange(range.start, range.count);
      run.instanceData.needsUpdate = true;
    },
    dispose() {
      disposed = true;
    },
  };
}

const noOpMsdfBatchUpdate: MsdfBatchUpdate = { commit: () => undefined, dispose: () => undefined };

function sameMsdfPaintStructure(run: MsdfBatchRun | undefined, paint: GlyphPaint): boolean {
  if (run === undefined) return true;
  for (let instance = 0; instance < run.logicalCount; instance += 1) {
    const glyphIndex = run.glyphIndices[instance]!;
    const entry = resolvedPaint(paint, glyphIndex);
    const offset = instance * PAINT_STRUCTURE_STRIDE;
    if (run.paintStructure[offset] !== (entry.outline?.width ?? 0)) return false;
    if (run.paintStructure[offset + 1] !== (entry.shadow?.offset[0] ?? 0)) return false;
    if (run.paintStructure[offset + 2] !== (entry.shadow?.offset[1] ?? 0)) return false;
  }
  return true;
}

function writeMsdfInstance(
  layout: ParagraphLayout,
  resource: MsdfResource,
  values: Float32Array,
  records: DataView,
  instance: number,
  glyphIndex: number,
  paint: ResolvedPaint,
  paintStructure: Float64Array | undefined,
): void {
  const glyphId = layout.glyphIds[glyphIndex]!;
  const record = glyphId * RECORD_STRIDE;
  const fontSize = layout.glyphFontSizes[glyphIndex]!;
  const scale = fontSize / resource.planeUnitsPerEm;
  const planeLeft = records.getInt16(record, true);
  const planeBottom = records.getInt16(record + 2, true);
  const planeRight = records.getInt16(record + 4, true);
  const planeTop = records.getInt16(record + 6, true);
  const atlasLeft = records.getUint16(record + 8, true);
  const atlasTop = records.getUint16(record + 10, true);
  const atlasRight = records.getUint16(record + 12, true);
  const atlasBottom = records.getUint16(record + 14, true);
  const pageIndex = records.getUint16(record + 16, true);
  const baseOriginX = layout.x[glyphIndex]! + planeLeft * scale;
  const baseOriginY = -layout.y[glyphIndex]! + planeBottom * scale;
  const baseWidth = (planeRight - planeLeft) * scale;
  const baseHeight = (planeTop - planeBottom) * scale;
  const shadowX = paint.shadow?.offset[0] ?? 0;
  const sourceShadowY = paint.shadow?.offset[1] ?? 0;
  const shadowY = -sourceShadowY;
  const originX = baseOriginX + Math.min(0, shadowX);
  const originY = baseOriginY + Math.min(0, shadowY);
  const width = baseWidth + Math.abs(shadowX);
  const height = baseHeight + Math.abs(shadowY);
  const baseUvX = atlasLeft / resource.atlas.width;
  const baseUvY = 1 - atlasBottom / resource.atlas.height;
  const baseUvWidth = (atlasRight - atlasLeft) / resource.atlas.width;
  const baseUvHeight = (atlasBottom - atlasTop) / resource.atlas.height;
  const uvPerUnitX = baseUvWidth / baseWidth;
  const uvPerUnitY = baseUvHeight / baseHeight;
  const uvOriginX = baseUvX + (originX - baseOriginX) * uvPerUnitX;
  const uvOriginY = baseUvY + (originY - baseOriginY) * uvPerUnitY;
  const outlineAtlasPixels = resolveMsdfOutlineAtlasPixels(resource, fontSize, paint.outline?.width ?? 0);
  const offset = instance * INSTANCE_STRIDE;
  values[offset + INSTANCE_OFFSETS.origin] = originX;
  values[offset + INSTANCE_OFFSETS.origin + 1] = originY;
  values[offset + INSTANCE_OFFSETS.size] = width;
  values[offset + INSTANCE_OFFSETS.size + 1] = height;
  values[offset + INSTANCE_OFFSETS.uvOrigin] = uvOriginX;
  values[offset + INSTANCE_OFFSETS.uvOrigin + 1] = uvOriginY;
  values[offset + INSTANCE_OFFSETS.uvSize] = width * uvPerUnitX;
  values[offset + INSTANCE_OFFSETS.uvSize + 1] = height * uvPerUnitY;
  values[offset + INSTANCE_OFFSETS.uvBounds] = baseUvX;
  values[offset + INSTANCE_OFFSETS.uvBounds + 1] = baseUvY;
  values[offset + INSTANCE_OFFSETS.uvBounds + 2] = baseUvX + baseUvWidth;
  values[offset + INSTANCE_OFFSETS.uvBounds + 3] = baseUvY + baseUvHeight;
  values[offset + INSTANCE_OFFSETS.shadowOffset] = shadowX * uvPerUnitX;
  values[offset + INSTANCE_OFFSETS.shadowOffset + 1] = shadowY * uvPerUnitY;
  values.set(paint.color, offset + INSTANCE_OFFSETS.fillColor);
  values.set(paint.outline?.color ?? TRANSPARENT_LINEAR_RGBA, offset + INSTANCE_OFFSETS.outlineColor);
  values[offset + INSTANCE_OFFSETS.outlineWidth] = outlineAtlasPixels / resource.pixelRange;
  values.set(paint.shadow?.color ?? TRANSPARENT_LINEAR_RGBA, offset + INSTANCE_OFFSETS.shadowColor);
  values[offset + INSTANCE_OFFSETS.pageIndex] = pageIndex;
  if (paintStructure !== undefined) {
    const structureOffset = instance * PAINT_STRUCTURE_STRIDE;
    paintStructure[structureOffset] = paint.outline?.width ?? 0;
    paintStructure[structureOffset + 1] = shadowX;
    paintStructure[structureOffset + 2] = sourceShadowY;
  }
}

function resolveMsdfOutlineAtlasPixels(resource: MsdfResource, fontSize: number, outlineWidth: number): number {
  if (!Number.isFinite(fontSize) || fontSize <= 0) {
    throw new TypeError('MTSDF glyph font sizes must be positive finite values');
  }
  const outlineAtlasPixels = outlineWidth / (fontSize / resource.planeUnitsPerEm);
  const maximum = resource.pixelRange / 2;
  if (outlineAtlasPixels > maximum) {
    throw new RangeError(`MTSDF outline width exceeds the ${maximum}-atlas-pixel field limit`);
  }
  return outlineAtlasPixels;
}

const TRANSPARENT_LINEAR_RGBA = [0, 0, 0, 0] as const;

function resolvedPaint(paint: GlyphPaint, glyphIndex: number): ResolvedPaint {
  const paintIndex = paint.paintIndices[glyphIndex];
  const resolved = paintIndex === undefined ? undefined : paint.palette[paintIndex];
  if (resolved === undefined) throw new TypeError('glyph paint references a missing palette entry');
  return resolved;
}

function assertMsdfPaint(paint: GlyphPaint): void {
  for (const entry of paint.palette) {
    assertLinearColor(entry.color, 'MTSDF fill');
    if (entry.outline !== undefined) {
      assertLinearColor(entry.outline.color, 'MTSDF outline');
      if (!Number.isFinite(entry.outline.width) || entry.outline.width < 0) {
        throw new TypeError('MTSDF outline width must be a non-negative finite value');
      }
    }
    if (entry.shadow !== undefined) {
      assertLinearColor(entry.shadow.color, 'MTSDF shadow');
      if (entry.shadow.offset.some((value) => !Number.isFinite(value))) {
        throw new TypeError('MTSDF shadow offsets must be finite values');
      }
    }
  }
}

function assertLinearColor(color: readonly number[], label: string): void {
  if (color.length !== 4 || color.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new TypeError(`${label} color must contain four finite linear values in [0, 1]`);
  }
}

function msdfMaterial(atlas: MsdfAtlasResource, pixelRange: number): THREE.MeshBasicNodeMaterial {
  const existing = materialByAtlasTexture.get(atlas.texture);
  if (existing !== undefined) return existing.material;
  const material = new THREE.MeshBasicNodeMaterial({
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const origin: Node<'vec2'> = tslAttribute<'vec2'>('msdfOrigin', 'vec2');
  const size: Node<'vec2'> = tslAttribute<'vec2'>('msdfSize', 'vec2');
  const uvOrigin: Node<'vec2'> = tslAttribute<'vec2'>('msdfUvOrigin', 'vec2');
  const uvSize: Node<'vec2'> = tslAttribute<'vec2'>('msdfUvSize', 'vec2');
  const uvBounds: Node<'vec4'> = tslAttribute<'vec4'>('msdfUvBounds', 'vec4');
  const shadowOffset: Node<'vec2'> = tslAttribute<'vec2'>('msdfShadowOffset', 'vec2');
  const fillColor: Node<'vec4'> = tslAttribute<'vec4'>('msdfFillColor', 'vec4');
  const outlineColor: Node<'vec4'> = tslAttribute<'vec4'>('msdfOutlineColor', 'vec4');
  const outlineWidth: Node<'float'> = tslAttribute<'float'>('msdfOutlineWidth', 'float');
  const shadowColor: Node<'vec4'> = tslAttribute<'vec4'>('msdfShadowColor', 'vec4');
  const pageIndex: Node<'float'> = tslAttribute<'float'>('msdfPageIndex', 'float');
  const unitUv: Node<'vec2'> = uv();
  const atlasU: Node<'float'> = add(uvOrigin.x, mul(unitUv.x, uvSize.x));
  const atlasV: Node<'float'> = add(uvOrigin.y, mul(unitUv.y, uvSize.y));
  const minimumU: Node<'float'> = add(uvBounds.x, 0.5 / atlas.width);
  const minimumV: Node<'float'> = add(uvBounds.y, 0.5 / atlas.height);
  const maximumU: Node<'float'> = sub(uvBounds.z, 0.5 / atlas.width);
  const maximumV: Node<'float'> = sub(uvBounds.w, 0.5 / atlas.height);
  const baseInside: Node<'float'> = insideRectangle(atlasU, atlasV, uvBounds);
  const clampedBaseU: Node<'float'> = clamp(atlasU, minimumU, maximumU);
  const clampedBaseV: Node<'float'> = clamp(atlasV, minimumV, maximumV);
  const layer: Node<'int'> = int(pageIndex);
  const baseSample: Node<'vec4'> = texture(atlas.texture, vec2(clampedBaseU, clampedBaseV)).depth(layer);
  const fillDistance: Node<'float'> = sub(median3(baseSample.rgb), 0.5);
  const trueDistance: Node<'float'> = sub(baseSample.a, 0.5);
  const pixelsPerDistanceUnit: Node<'float'> = screenPixelRange(atlasU, atlasV, atlas, pixelRange);
  const fillCoverage: Node<'float'> = mul(distanceCoverage(fillDistance, pixelsPerDistanceUnit), baseInside);
  const outlineDistance: Node<'float'> = add(trueDistance, outlineWidth);
  const outlineCoverage: Node<'float'> = mul(distanceCoverage(outlineDistance, pixelsPerDistanceUnit), baseInside);
  const outlineOnly: Node<'float'> = max(sub(outlineCoverage, fillCoverage), 0);
  const shadowU: Node<'float'> = sub(atlasU, shadowOffset.x);
  const shadowV: Node<'float'> = sub(atlasV, shadowOffset.y);
  const shadowInside: Node<'float'> = insideRectangle(shadowU, shadowV, uvBounds);
  const clampedShadowU: Node<'float'> = clamp(shadowU, minimumU, maximumU);
  const clampedShadowV: Node<'float'> = clamp(shadowV, minimumV, maximumV);
  const shadowSample: Node<'vec4'> = texture(atlas.texture, vec2(clampedShadowU, clampedShadowV)).depth(layer);
  const shadowDistance: Node<'float'> = sub(shadowSample.a, 0.5);
  const shadowCoverage: Node<'float'> = mul(distanceCoverage(shadowDistance, pixelsPerDistanceUnit), shadowInside);
  const shadowAlpha: Node<'float'> = mul(shadowColor.a, shadowCoverage);
  const outlineAlpha: Node<'float'> = mul(outlineColor.a, outlineOnly);
  const fillAlpha: Node<'float'> = mul(fillColor.a, fillCoverage);
  // Fill and outlineOnly are disjoint geometric coverages. Summing them forms the complete
  // expanded glyph silhouette; compositing outlineOnly behind fill would attenuate it twice.
  const glyphAlpha: Node<'float'> = add(fillAlpha, outlineAlpha);
  const glyphRed: Node<'float'> = add(mul(fillColor.r, fillAlpha), mul(outlineColor.r, outlineAlpha));
  const glyphGreen: Node<'float'> = add(mul(fillColor.g, fillAlpha), mul(outlineColor.g, outlineAlpha));
  const glyphBlue: Node<'float'> = add(mul(fillColor.b, fillAlpha), mul(outlineColor.b, outlineAlpha));
  const shadowRemainder: Node<'float'> = mul(shadowAlpha, sub(1, glyphAlpha));
  const outputAlpha: Node<'float'> = add(glyphAlpha, shadowRemainder);
  const outputRed: Node<'float'> = add(glyphRed, mul(shadowColor.r, shadowRemainder));
  const outputGreen: Node<'float'> = add(glyphGreen, mul(shadowColor.g, shadowRemainder));
  const outputBlue: Node<'float'> = add(glyphBlue, mul(shadowColor.b, shadowRemainder));
  const safeOutputAlpha: Node<'float'> = max(outputAlpha, 1e-6);
  const outputColor: Node<'vec3'> = vec3(
    div(outputRed, safeOutputAlpha),
    div(outputGreen, safeOutputAlpha),
    div(outputBlue, safeOutputAlpha),
  );
  const positionX: Node<'float'> = add(origin.x, mul(positionLocal.x, size.x));
  const positionY: Node<'float'> = add(origin.y, mul(positionLocal.y, size.y));
  material.positionNode = vec3(positionX, positionY, 0);
  material.colorNode = outputColor;
  material.opacityNode = outputAlpha;
  materialByAtlasTexture.set(atlas.texture, { material });
  return material;
}

function median3(value: Node<'vec3'>): Node<'float'> {
  const lowerPair: Node<'float'> = min(value.r, value.g);
  const upperPair: Node<'float'> = max(value.r, value.g);
  return max(lowerPair, min(upperPair, value.b));
}

function screenPixelRange(
  atlasU: Node<'float'>,
  atlasV: Node<'float'>,
  atlas: MsdfAtlasResource,
  pixelRange: number,
): Node<'float'> {
  const screenTexelsU: Node<'float'> = div(1, max(fwidth(atlasU), 1e-6));
  const screenTexelsV: Node<'float'> = div(1, max(fwidth(atlasV), 1e-6));
  const projectedRange: Node<'float'> = mul(
    0.5,
    add(mul(pixelRange / atlas.width, screenTexelsU), mul(pixelRange / atlas.height, screenTexelsV)),
  );
  return max(projectedRange, 1);
}

function distanceCoverage(distance: Node<'float'>, pixelsPerDistanceUnit: Node<'float'>): Node<'float'> {
  return clamp(add(mul(distance, pixelsPerDistanceUnit), 0.5), 0, 1);
}

function insideRectangle(pointU: Node<'float'>, pointV: Node<'float'>, bounds: Node<'vec4'>): Node<'float'> {
  const insideX: Node<'float'> = mul(step(bounds.x, pointU), step(pointU, bounds.z));
  const insideY: Node<'float'> = mul(step(bounds.y, pointV), step(pointV, bounds.w));
  return mul(insideX, insideY);
}
