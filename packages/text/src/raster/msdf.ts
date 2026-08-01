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
  unitRasterQuadGeometry,
} from '../internal/raster-batch.js';
import type { ParagraphLayout } from '../layout.js';
import type { GlyphPaint, ResolvedPaint } from '../paint.js';
import {
  defineRaster,
  defineRasterBatchStage,
  type JsonValue,
  type RasterModule,
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
  readonly glyphIndices: Uint32Array;
  readonly instanceData: THREE.InstancedInterleavedBuffer;
  readonly paintStructure: Float64Array;
  readonly originAttribute: THREE.InterleavedBufferAttribute;
  readonly sizeAttribute: THREE.InterleavedBufferAttribute;
  readonly uvOriginAttribute: THREE.InterleavedBufferAttribute;
  readonly uvSizeAttribute: THREE.InterleavedBufferAttribute;
  readonly uvBoundsAttribute: THREE.InterleavedBufferAttribute;
  readonly shadowOffsetAttribute: THREE.InterleavedBufferAttribute;
  readonly fillColorAttribute: THREE.InterleavedBufferAttribute;
  readonly outlineColorAttribute: THREE.InterleavedBufferAttribute;
  readonly outlineWidthAttribute: THREE.InterleavedBufferAttribute;
  readonly shadowColorAttribute: THREE.InterleavedBufferAttribute;
  readonly pageIndexAttribute: THREE.InterleavedBufferAttribute;
  readonly geometry: THREE.InstancedBufferGeometry;
  readonly mesh: THREE.Mesh;
}

export interface MsdfDrawBatch {
  readonly object: THREE.Group;
  readonly glyphCount: number;
  readonly drawCount: number;
  dispose(): void;
}

interface MsdfMaterialState {
  readonly material: THREE.MeshBasicNodeMaterial;
}

const materialByAtlasTexture = new WeakMap<THREE.DataArrayTexture, MsdfMaterialState>();
const batchContext = new WeakMap<
  MsdfDrawBatch,
  {
    readonly layout: ParagraphLayout;
    readonly resource: MsdfResource;
    readonly fontSlot: number;
    readonly run: MsdfBatchRun | undefined;
  }
>();

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
  async prepare(layout, resource, fontSlot, signal) {
    signal?.throwIfAborted();
    assertRasterCoverage(layout, fontSlot, resource.coverage, MSDF_KIND);
  },
  stageBatch(previous, layout, resource, fontSlot, paint) {
    const context = previous === undefined ? undefined : batchContext.get(previous);
    if (
      previous !== undefined &&
      context?.layout === layout &&
      context.resource === resource &&
      context.fontSlot === fontSlot
    ) {
      assertMsdfBatchPaintUpdate(layout, resource, context.run, paint);
      return defineRasterBatchStage(
        previous,
        () => commitMsdfBatchPaint(context.run, layout, resource, paint),
        () => undefined,
      );
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
  const records = new DataView(resource.records.buffer, resource.records.byteOffset, resource.records.byteLength);
  const group = new THREE.Group();
  const glyphIndices: number[] = [];

  for (let glyphIndex = 0; glyphIndex < layout.glyphIds.length; glyphIndex += 1) {
    if (layout.glyphFontSlots[glyphIndex] !== fontSlot) continue;
    const glyphId = layout.glyphIds[glyphIndex];
    if (glyphId === undefined) continue;
    if (glyphId >= resource.records.byteLength / RECORD_STRIDE) {
      throw new TypeError('paragraph layout references an MTSDF glyph outside the registered font');
    }
    const pageIndex = records.getUint16(glyphId * RECORD_STRIDE + 16, true);
    if (pageIndex === ABSENT_PAGE) continue;
    if (resource.pages[pageIndex] === undefined) {
      throw new TypeError('MTSDF batch references a missing page');
    }
    glyphIndices.push(glyphIndex);
  }
  const run = glyphIndices.length === 0 ? undefined : createMsdfRun(layout, resource, glyphIndices, paint);
  if (run !== undefined) group.add(run.mesh);

  let disposed = false;
  const batch: MsdfDrawBatch = {
    object: group,
    glyphCount: glyphIndices.length,
    drawCount: run === undefined ? 0 : 1,
    dispose() {
      if (disposed) return;
      disposed = true;
      batchContext.delete(batch);
      group.clear();
      run?.geometry.dispose();
    },
  };
  batchContext.set(batch, { layout, resource, fontSlot, run });
  return batch;
}

function createMsdfRun(
  layout: ParagraphLayout,
  resource: MsdfResource,
  glyphIndices: readonly number[],
  paint: GlyphPaint,
): MsdfBatchRun {
  const count = glyphIndices.length;
  const geometry = unitRasterQuadGeometry();
  geometry.instanceCount = count;
  const instanceData = new THREE.InstancedInterleavedBuffer(
    new Float32Array(count * INSTANCE_STRIDE),
    INSTANCE_STRIDE,
    1,
  );
  const originAttribute = instanceAttribute(geometry, instanceData, 'msdfOrigin', 2, INSTANCE_OFFSETS.origin);
  const sizeAttribute = instanceAttribute(geometry, instanceData, 'msdfSize', 2, INSTANCE_OFFSETS.size);
  const uvOriginAttribute = instanceAttribute(geometry, instanceData, 'msdfUvOrigin', 2, INSTANCE_OFFSETS.uvOrigin);
  const uvSizeAttribute = instanceAttribute(geometry, instanceData, 'msdfUvSize', 2, INSTANCE_OFFSETS.uvSize);
  const uvBoundsAttribute = instanceAttribute(geometry, instanceData, 'msdfUvBounds', 4, INSTANCE_OFFSETS.uvBounds);
  const shadowOffsetAttribute = instanceAttribute(
    geometry,
    instanceData,
    'msdfShadowOffset',
    2,
    INSTANCE_OFFSETS.shadowOffset,
  );
  const fillColorAttribute = instanceAttribute(geometry, instanceData, 'msdfFillColor', 4, INSTANCE_OFFSETS.fillColor);
  const outlineColorAttribute = instanceAttribute(
    geometry,
    instanceData,
    'msdfOutlineColor',
    4,
    INSTANCE_OFFSETS.outlineColor,
  );
  const outlineWidthAttribute = instanceAttribute(
    geometry,
    instanceData,
    'msdfOutlineWidth',
    1,
    INSTANCE_OFFSETS.outlineWidth,
  );
  const shadowColorAttribute = instanceAttribute(
    geometry,
    instanceData,
    'msdfShadowColor',
    4,
    INSTANCE_OFFSETS.shadowColor,
  );
  const pageIndexAttribute = instanceAttribute(geometry, instanceData, 'msdfPageIndex', 1, INSTANCE_OFFSETS.pageIndex);
  const mesh = new THREE.Mesh(geometry, msdfMaterial(resource.atlas, resource.pixelRange));
  mesh.frustumCulled = false;
  mesh.renderOrder = glyphIndices[0] ?? 0;
  const run: MsdfBatchRun = {
    glyphIndices: Uint32Array.from(glyphIndices),
    instanceData,
    paintStructure: new Float64Array(count * PAINT_STRUCTURE_STRIDE),
    originAttribute,
    sizeAttribute,
    uvOriginAttribute,
    uvSizeAttribute,
    uvBoundsAttribute,
    shadowOffsetAttribute,
    fillColorAttribute,
    outlineColorAttribute,
    outlineWidthAttribute,
    shadowColorAttribute,
    pageIndexAttribute,
    geometry,
    mesh,
  };
  updateMsdfRun(layout, resource, run, paint);
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

function updateMsdfRun(layout: ParagraphLayout, resource: MsdfResource, run: MsdfBatchRun, paint: GlyphPaint): void {
  const records = new DataView(resource.records.buffer, resource.records.byteOffset, resource.records.byteLength);
  for (let instance = 0; instance < run.glyphIndices.length; instance += 1) {
    const glyphIndex = run.glyphIndices[instance]!;
    const paintEntry = resolvedPaint(paint, glyphIndex);
    writeMsdfInstance(layout, resource, run, records, instance, glyphIndex, paintEntry);
  }
  run.instanceData.needsUpdate = true;
}

function assertMsdfBatchPaintUpdate(
  layout: ParagraphLayout,
  resource: MsdfResource,
  run: MsdfBatchRun | undefined,
  paint: GlyphPaint,
): void {
  assertParallelRasterPaint(layout, paint);
  assertMsdfPaint(paint);
  if (run === undefined) return;
  for (const glyphIndex of run.glyphIndices) {
    const entry = resolvedPaint(paint, glyphIndex);
    const fontSize = layout.glyphFontSizes[glyphIndex]!;
    resolveMsdfOutlineAtlasPixels(resource, fontSize, entry.outline?.width ?? 0);
  }
}

function commitMsdfBatchPaint(
  run: MsdfBatchRun | undefined,
  layout: ParagraphLayout,
  resource: MsdfResource,
  paint: GlyphPaint,
): void {
  if (run === undefined) return;
  if (sameMsdfPaintStructure(run, paint)) updateMsdfRunColors(run, paint);
  else updateMsdfRun(layout, resource, run, paint);
}

const PAINT_STRUCTURE_STRIDE = 3;

function sameMsdfPaintStructure(run: MsdfBatchRun, next: GlyphPaint): boolean {
  for (let instance = 0; instance < run.glyphIndices.length; instance += 1) {
    const glyphIndex = run.glyphIndices[instance]!;
    const nextPaint = resolvedPaint(next, glyphIndex);
    const offset = instance * PAINT_STRUCTURE_STRIDE;
    if (run.paintStructure[offset] !== (nextPaint.outline?.width ?? 0)) return false;
    if (run.paintStructure[offset + 1] !== (nextPaint.shadow?.offset[0] ?? 0)) return false;
    if (run.paintStructure[offset + 2] !== (nextPaint.shadow?.offset[1] ?? 0)) return false;
  }
  return true;
}

function updateMsdfRunColors(run: MsdfBatchRun, paint: GlyphPaint): void {
  for (let instance = 0; instance < run.glyphIndices.length; instance += 1) {
    const paintEntry = resolvedPaint(paint, run.glyphIndices[instance]!);
    setAttribute4(run.fillColorAttribute, instance, ...paintEntry.color);
    setAttribute4(run.outlineColorAttribute, instance, ...(paintEntry.outline?.color ?? TRANSPARENT_LINEAR_RGBA));
    setAttribute4(run.shadowColorAttribute, instance, ...(paintEntry.shadow?.color ?? TRANSPARENT_LINEAR_RGBA));
  }
  run.instanceData.needsUpdate = true;
}

function writeMsdfInstance(
  layout: ParagraphLayout,
  resource: MsdfResource,
  run: MsdfBatchRun,
  records: DataView,
  instance: number,
  glyphIndex: number,
  paint: ResolvedPaint,
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
  setAttribute2(run.originAttribute, instance, originX, originY);
  setAttribute2(run.sizeAttribute, instance, width, height);
  setAttribute2(run.uvOriginAttribute, instance, uvOriginX, uvOriginY);
  setAttribute2(run.uvSizeAttribute, instance, width * uvPerUnitX, height * uvPerUnitY);
  setAttribute4(run.uvBoundsAttribute, instance, baseUvX, baseUvY, baseUvX + baseUvWidth, baseUvY + baseUvHeight);
  setAttribute2(run.shadowOffsetAttribute, instance, shadowX * uvPerUnitX, shadowY * uvPerUnitY);
  setAttribute4(run.fillColorAttribute, instance, ...paint.color);
  setAttribute4(run.outlineColorAttribute, instance, ...(paint.outline?.color ?? TRANSPARENT_LINEAR_RGBA));
  setAttribute1(run.outlineWidthAttribute, instance, outlineAtlasPixels / resource.pixelRange);
  setAttribute4(run.shadowColorAttribute, instance, ...(paint.shadow?.color ?? TRANSPARENT_LINEAR_RGBA));
  setAttribute1(run.pageIndexAttribute, instance, pageIndex);
  const paintStructureOffset = instance * PAINT_STRUCTURE_STRIDE;
  run.paintStructure[paintStructureOffset] = paint.outline?.width ?? 0;
  run.paintStructure[paintStructureOffset + 1] = shadowX;
  run.paintStructure[paintStructureOffset + 2] = sourceShadowY;
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

function attributeArrayOffset(attribute: THREE.InterleavedBufferAttribute, instance: number): number {
  return instance * attribute.data.stride + attribute.offset;
}

function setAttribute1(attribute: THREE.InterleavedBufferAttribute, instance: number, x: number): void {
  const array = attribute.data.array as Float32Array;
  array[attributeArrayOffset(attribute, instance)] = x;
}

function setAttribute2(attribute: THREE.InterleavedBufferAttribute, instance: number, x: number, y: number): void {
  const array = attribute.data.array as Float32Array;
  const offset = attributeArrayOffset(attribute, instance);
  array[offset] = x;
  array[offset + 1] = y;
}

function setAttribute4(
  attribute: THREE.InterleavedBufferAttribute,
  instance: number,
  x: number,
  y: number,
  z: number,
  w: number,
): void {
  const array = attribute.data.array as Float32Array;
  const offset = attributeArrayOffset(attribute, instance);
  array[offset] = x;
  array[offset + 1] = y;
  array[offset + 2] = z;
  array[offset + 3] = w;
}

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
