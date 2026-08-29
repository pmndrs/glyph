import {
  FontArtifactValidationError,
  evaluateExtensionSchema,
  parseGlb,
  validateWithKhronos,
  type KhronosValidationReport,
  type ParsedGlb,
} from '../font-baker/validator.js';
import { GlyphError } from '../glyph-error.js';
import {
  KHR_DF_CHANNEL_RGBSDA_ALPHA,
  KHR_DF_CHANNEL_RGBSDA_BLUE,
  KHR_DF_CHANNEL_RGBSDA_GREEN,
  KHR_DF_CHANNEL_RGBSDA_RED,
  VK_FORMAT_R16G16B16A16_SFLOAT,
} from 'ktx-parse';

import binaryResourceSchema from './schemas/binaryResource.PMNDRS_font.schema.json' with { type: 'json' };
import slugSchema from './schemas/glTF.PMNDRS_font_slug.schema.json' with { type: 'json' };
import sourceSchema from './schemas/resourceSource.PMNDRS_font.schema.json' with { type: 'json' };
import textureResourceSchema from './schemas/textureResource.PMNDRS_font.schema.json' with { type: 'json' };
import type { RasterKey, Fingerprint } from '../identity.js';
import {
  RasterArtifactValidationError,
  asArray,
  asInteger,
  checkedProduct,
  checkedSum,
  claimCoreRasterViews,
  claimOtherRasterExtensionViews,
  claimRasterView,
  fail,
  isFingerprint,
  requireNonArrayObject,
  resolveRasterPageSource,
  sliceRasterView,
  stringArray,
  validateNativeKtx2,
  validateRasterBufferViews,
  withSchemaId,
  type RasterArtifactValidationIssue,
  type RasterBufferView,
  type ResolvedRasterPageSource,
} from '../internal/raster-artifact-validation.js';
import {
  SLUG_EXTENSION,
  SLUG_FORMAT_VERSION,
  SLUG_GENERATOR_VERSION,
  SLUG_GLYPH_RECORD_STRIDE,
  SLUG_PLANE_UNITS_PER_EM,
  slugDescriptorRasterKey,
  type SlugDescriptor,
} from '../internal/slug-contract.js';

const CURVE_BYTES_PER_TEXEL = 8;
const HEADER_BYTES_PER_TEXEL = 4;
const REFERENCE_BYTES_PER_TEXEL = 2;
const ABSENT_PAGE = 0xffff;
const CURVE_FORMAT = {
  vkFormat: VK_FORMAT_R16G16B16A16_SFLOAT,
  typeSize: 2,
  blockWidth: 1,
  blockHeight: 1,
  bytesPerBlock: CURVE_BYTES_PER_TEXEL,
  float16ChannelTypes: [
    KHR_DF_CHANNEL_RGBSDA_RED,
    KHR_DF_CHANNEL_RGBSDA_GREEN,
    KHR_DF_CHANNEL_RGBSDA_BLUE,
    KHR_DF_CHANNEL_RGBSDA_ALPHA,
  ],
} as const;

export type SlugArtifactValidationIssue = RasterArtifactValidationIssue;

export interface SlugArtifactValidationLimits {
  readonly maxTextureDimension2D: number;
  readonly maxGpuBytes: number;
}

export interface SlugArtifactValidationContext {
  readonly rasterKey: RasterKey | string;
  readonly shapingFingerprint: Fingerprint | string;
  readonly glyphCount: number;
  readonly glyphIdWidth: 16;
  readonly descriptor: SlugDescriptor;
  readonly externalPages?: ReadonlyMap<string, Uint8Array>;
  readonly limits?: Partial<SlugArtifactValidationLimits>;
}

export interface ValidatedSlugResource {
  readonly bytes: Uint8Array;
  readonly source: 'embedded' | 'external';
  readonly uri?: string;
}

export interface ValidatedSlugPage {
  readonly curveWidth: number;
  readonly curveHeight: number;
  readonly curve: ValidatedSlugResource;
  readonly headerCount: number;
  readonly headerWidth: number;
  readonly headerHeight: number;
  readonly headers: ValidatedSlugResource;
  readonly referenceCount: number;
  readonly referenceWidth: number;
  readonly referenceHeight: number;
  readonly references: ValidatedSlugResource;
}

export interface ValidatedSlugArtifact {
  readonly document: Readonly<Record<string, unknown>>;
  readonly rasterKey: RasterKey;
  readonly shapingFingerprint: Fingerprint;
  readonly glyphCount: number;
  readonly records: Uint8Array;
  readonly pages: readonly ValidatedSlugPage[];
  readonly khronos: KhronosValidationReport;
}

export class SlugArtifactValidationError extends GlyphError<'artifact-invalid'> {
  readonly issues: readonly SlugArtifactValidationIssue[];

  constructor(issues: readonly SlugArtifactValidationIssue[]) {
    super(
      'artifact-invalid',
      issues
        .map((issue) => `${issue.code}${issue.path === undefined ? '' : ` ${issue.path}`}: ${issue.message}`)
        .join('\n'),
    );
    this.name = 'SlugArtifactValidationError';
    this.issues = issues;
  }
}

/** Validate one fixed V0 Slug companion before registering or uploading it. */
export async function validateSlugArtifact(
  bytes: Uint8Array,
  context: SlugArtifactValidationContext,
): Promise<ValidatedSlugArtifact> {
  try {
    const parsed = parseGlb(bytes);
    const khronos = await validateWithKhronos(bytes, parsed.document);
    return await validateSlugSemantics(parsed, khronos, context);
  } catch (error) {
    if (error instanceof SlugArtifactValidationError) throw error;
    if (error instanceof FontArtifactValidationError || error instanceof RasterArtifactValidationError) {
      throw new SlugArtifactValidationError(error.issues);
    }
    throw error;
  }
}

async function validateSlugSemantics(
  parsed: ParsedGlb,
  khronos: KhronosValidationReport,
  context: SlugArtifactValidationContext,
): Promise<ValidatedSlugArtifact> {
  await validateContext(context);
  const document = parsed.document;
  const used = stringArray(document.extensionsUsed, '/extensionsUsed');
  const required = stringArray(document.extensionsRequired, '/extensionsRequired');
  const extensions = requireNonArrayObject(document.extensions, '/extensions');
  const combined = extensions.PMNDRS_font !== undefined;
  if (!used.includes(SLUG_EXTENSION) || (!combined && !required.includes(SLUG_EXTENSION))) {
    fail(
      'SLUG_EXTENSION_REQUIRED',
      'Slug GLB must use its extension, and a split companion must require it',
      '/extensionsRequired',
    );
  }

  const extensionPath = `/extensions/${SLUG_EXTENSION}`;
  const extension = requireNonArrayObject(extensions[SLUG_EXTENSION], extensionPath);
  const schemaIssues = evaluateExtensionSchema(
    extension,
    withSchemaId(slugSchema, 'extensions/PMNDRS_font_slug/schema/glTF.PMNDRS_font_slug.schema.json'),
    extensionPath,
    [
      {
        id: 'extensions/schema/resourceSource.PMNDRS_font.schema.json',
        schema: sourceSchema,
      },
      {
        id: 'extensions/schema/binaryResource.PMNDRS_font.schema.json',
        schema: binaryResourceSchema,
      },
      {
        id: 'extensions/schema/textureResource.PMNDRS_font.schema.json',
        schema: textureResourceSchema,
      },
    ],
  );
  if (schemaIssues.length !== 0) throw new SlugArtifactValidationError(schemaIssues);
  if (
    extension.version !== SLUG_FORMAT_VERSION ||
    extension.rasterKey !== context.rasterKey ||
    extension.shapingFingerprint !== context.shapingFingerprint ||
    extension.glyphCount !== context.glyphCount ||
    extension.glyphIdWidth !== context.glyphIdWidth
  ) {
    fail(
      'RECIPROCAL_IDENTITY',
      'Slug extension identity does not match the selected core font/raster binding',
      extensionPath,
    );
  }
  if (extension.planeUnitsPerEm !== SLUG_PLANE_UNITS_PER_EM || extension.recordStride !== SLUG_GLYPH_RECORD_STRIDE) {
    fail('SLUG_CONSTANTS', 'artifact does not match the fixed V0 Slug contract', extensionPath);
  }

  const limits = resolveLimits(context.limits);
  const views = validateRasterBufferViews(parsed, 'Slug');
  const claimedViews = new Set<number>();
  if (combined) {
    claimCoreRasterViews(extensions.PMNDRS_font, claimedViews, views.length, SLUG_EXTENSION, 'Slug');
  }
  const recordViewIndex = asInteger(
    extension.recordBufferView,
    `${extensionPath}/recordBufferView`,
    0,
    views.length - 1,
  );
  claimRasterView(claimedViews, views, recordViewIndex, `${extensionPath}/recordBufferView`, 'Slug');
  const expectedRecordBytes = checkedProduct(context.glyphCount, SLUG_GLYPH_RECORD_STRIDE, `${extensionPath}/records`);
  if (views[recordViewIndex]?.byteLength !== expectedRecordBytes) {
    fail(
      'RECORD_LENGTH',
      'record view must contain exactly glyphCount × 40 bytes',
      `${extensionPath}/recordBufferView`,
    );
  }

  let gpuBytes = 0;
  const pages: ValidatedSlugPage[] = [];
  const pageValues = asArray(extension.pages, `${extensionPath}/pages`);
  for (let pageIndex = 0; pageIndex < pageValues.length; pageIndex += 1) {
    const pagePath = `${extensionPath}/pages/${pageIndex}`;
    const page = requireNonArrayObject(pageValues[pageIndex], pagePath);
    const validated = await validatePage(page, pagePath, parsed, views, claimedViews, context.externalPages, limits);
    gpuBytes = checkedSum(gpuBytes, pageGpuBytes(validated, pagePath), pagePath);
    if (gpuBytes > limits.maxGpuBytes) {
      fail('GPU_BUDGET', 'Slug pages exceed the configured GPU byte budget', pagePath);
    }
    pages.push(validated);
  }

  const records = sliceRasterView(parsed, views[recordViewIndex]!);
  validateSlugRecords(records, pages, context.glyphCount, extensionPath);
  if (combined) {
    claimOtherRasterExtensionViews(extensions, claimedViews, views.length, SLUG_EXTENSION);
  }
  if (claimedViews.size !== views.length) {
    fail('BUFFER_VIEW_UNCLAIMED', 'Slug artifact contains an unclaimed buffer view', '/bufferViews');
  }

  return {
    document,
    rasterKey: context.rasterKey as RasterKey,
    shapingFingerprint: context.shapingFingerprint as Fingerprint,
    glyphCount: context.glyphCount,
    records,
    pages,
    khronos,
  };
}

async function validateContext(context: SlugArtifactValidationContext): Promise<void> {
  const descriptor = requireNonArrayObject(context.descriptor, '/descriptor');
  if (
    Object.keys(descriptor).length !== 1 ||
    !Object.hasOwn(descriptor, 'generatorVersion') ||
    descriptor.generatorVersion !== SLUG_GENERATOR_VERSION
  ) {
    fail('SLUG_DESCRIPTOR', 'descriptor does not match the fixed Slug generator', '/descriptor');
  }
  if (context.rasterKey !== slugDescriptorRasterKey()) {
    fail('RASTER_KEY', 'expected raster key does not match the fixed descriptor', '/rasterKey');
  }
  if (!isFingerprint(context.shapingFingerprint)) {
    fail(
      'SHAPING_FINGERPRINT',
      'expected shaping fingerprint must be lowercase 128-bit hexadecimal',
      '/shapingFingerprint',
    );
  }
  if (!Number.isInteger(context.glyphCount) || context.glyphCount < 1 || context.glyphCount > 65_535) {
    fail('GLYPH_COUNT', 'expected glyph count must be in 1..=65535', '/glyphCount');
  }
}

async function validatePage(
  page: Record<string, unknown>,
  pagePath: string,
  parsed: ParsedGlb,
  views: readonly RasterBufferView[],
  claimedViews: Set<number>,
  externalPages: ReadonlyMap<string, Uint8Array> | undefined,
  limits: SlugArtifactValidationLimits,
): Promise<ValidatedSlugPage> {
  const curve = requireNonArrayObject(page.curve, `${pagePath}/curve`);
  const curveWidth = asInteger(curve.width, `${pagePath}/curve/width`, 1, limits.maxTextureDimension2D);
  const curveHeight = asInteger(curve.height, `${pagePath}/curve/height`, 1, limits.maxTextureDimension2D);
  if (curve.mipLevelCount !== 1 || curve.colorSpace !== 'linear') {
    fail('CURVE_BASELINE', 'Slug curve pages must be single-level linear resources', pagePath);
  }
  const variants = asArray(curve.variants, `${pagePath}/curve/variants`);
  if (variants.length !== 1) {
    fail('VARIANT_COUNT', 'Slug V0 curve pages must contain exactly one variant', pagePath);
  }
  const variantPath = `${pagePath}/curve/variants/0`;
  const variant = requireNonArrayObject(variants[0], variantPath);
  if (
    variant.container !== 'ktx2' ||
    variant.gpuFormat !== 'rgba16float' ||
    variant.requiredFeature !== undefined ||
    variant.quality !== 'lossless'
  ) {
    fail('VARIANT_CONTRACT', 'Slug V0 requires one lossless native RGBA16F KTX2 curve variant', variantPath);
  }
  const curveSource = requireNonArrayObject(variant.source, `${variantPath}/source`);
  const curveResource = await resolveRasterPageSource(
    curveSource,
    variantPath,
    parsed,
    views,
    claimedViews,
    externalPages,
    'Slug curve',
  );
  validateNativeKtx2(curveResource.bytes, curveWidth, curveHeight, CURVE_FORMAT, variantPath);

  const headerWidth = asInteger(page.headerWidth, `${pagePath}/headerWidth`, 1, limits.maxTextureDimension2D);
  const headerHeight = asInteger(page.headerHeight, `${pagePath}/headerHeight`, 1, limits.maxTextureDimension2D);
  const headerCapacity = checkedProduct(headerWidth, headerHeight, `${pagePath}/headers`);
  const headerCount = asInteger(page.headerCount, `${pagePath}/headerCount`, 0, headerCapacity);
  const headerResource = await resolveBinaryResource(
    page.headerResource,
    `${pagePath}/headerResource`,
    parsed,
    views,
    claimedViews,
    externalPages,
    'Slug headers',
  );
  validateIntegerGrid(
    headerResource.bytes,
    headerCapacity,
    headerCount,
    HEADER_BYTES_PER_TEXEL,
    `${pagePath}/headerResource`,
  );

  const referenceWidth = asInteger(page.referenceWidth, `${pagePath}/referenceWidth`, 1, limits.maxTextureDimension2D);
  const referenceHeight = asInteger(
    page.referenceHeight,
    `${pagePath}/referenceHeight`,
    1,
    limits.maxTextureDimension2D,
  );
  const referenceCapacity = checkedProduct(referenceWidth, referenceHeight, `${pagePath}/references`);
  const referenceCount = asInteger(page.referenceCount, `${pagePath}/referenceCount`, 0, referenceCapacity);
  const referenceResource = await resolveBinaryResource(
    page.referenceResource,
    `${pagePath}/referenceResource`,
    parsed,
    views,
    claimedViews,
    externalPages,
    'Slug references',
  );
  validateIntegerGrid(
    referenceResource.bytes,
    referenceCapacity,
    referenceCount,
    REFERENCE_BYTES_PER_TEXEL,
    `${pagePath}/referenceResource`,
  );

  return {
    curveWidth,
    curveHeight,
    curve: validatedResource(curveResource),
    headerCount,
    headerWidth,
    headerHeight,
    headers: validatedResource(headerResource),
    referenceCount,
    referenceWidth,
    referenceHeight,
    references: validatedResource(referenceResource),
  };
}

async function resolveBinaryResource(
  value: unknown,
  path: string,
  parsed: ParsedGlb,
  views: readonly RasterBufferView[],
  claimedViews: Set<number>,
  externalPages: ReadonlyMap<string, Uint8Array> | undefined,
  label: string,
): Promise<ResolvedRasterPageSource> {
  const resource = requireNonArrayObject(value, path);
  const source = requireNonArrayObject(resource.source, `${path}/source`);
  return resolveRasterPageSource(source, path, parsed, views, claimedViews, externalPages, label);
}

function validateIntegerGrid(
  bytes: Uint8Array,
  capacity: number,
  count: number,
  bytesPerTexel: number,
  path: string,
): void {
  const expectedBytes = checkedProduct(capacity, bytesPerTexel, path);
  if (bytes.byteLength !== expectedBytes) {
    fail('GRID_LENGTH', 'integer grid source length does not match its declared dimensions', path);
  }
  const tailStart = checkedProduct(count, bytesPerTexel, path);
  if (!bytes.subarray(tailStart).every((value) => value === 0)) {
    fail('GRID_ZERO_TAIL', 'unused trailing integer texels must be zero', path);
  }
}

function validateSlugRecords(
  records: Uint8Array,
  pages: readonly ValidatedSlugPage[],
  glyphCount: number,
  path: string,
): void {
  const view = new DataView(records.buffer, records.byteOffset, records.byteLength);
  for (let glyphId = 0; glyphId < glyphCount; glyphId += 1) {
    const offset = glyphId * SLUG_GLYPH_RECORD_STRIDE;
    const glyphPath = `${path}/records/${glyphId}`;
    const pageIndex = view.getUint16(offset + 8, true);
    if (pageIndex === ABSENT_PAGE) {
      if (!recordAbsentPayloadIsZero(records, offset)) {
        fail('RECORD_ABSENT_DATA', 'absent Slug glyph data must be zero', glyphPath);
      }
      continue;
    }
    const page = pages[pageIndex];
    if (page === undefined) fail('RECORD_PAGE', 'Slug glyph page index is out of range', glyphPath);
    if (
      view.getInt16(offset, true) >= view.getInt16(offset + 4, true) ||
      view.getInt16(offset + 2, true) >= view.getInt16(offset + 6, true)
    ) {
      fail('RECORD_PLANE_BOUNDS', 'present Slug glyph plane bounds must be non-empty', glyphPath);
    }
    const horizontalBandCount = view.getUint16(offset + 10, true);
    const verticalBandCount = view.getUint16(offset + 12, true);
    if (horizontalBandCount === 0 || verticalBandCount === 0) {
      fail('RECORD_BAND_COUNT', 'present Slug glyphs must declare both band axes', glyphPath);
    }
    if (view.getUint16(offset + 14, true) !== 0) {
      fail('RECORD_FLAGS', 'Slug V0 record flags must be zero', glyphPath);
    }
    const curveBase = view.getUint32(offset + 16, true);
    const curveSpan = view.getUint32(offset + 20, true);
    const horizontalHeaderBase = view.getUint32(offset + 24, true);
    const verticalHeaderBase = view.getUint32(offset + 28, true);
    const referenceBase = view.getUint32(offset + 32, true);
    const referenceCount = view.getUint32(offset + 36, true);
    if (curveSpan === 0 || curveSpan > 0xffff || referenceCount > 0xffff) {
      fail(
        'RECORD_U16_OVERFLOW',
        'Slug curve spans and glyph-local reference counts must fit u16 and be non-empty',
        glyphPath,
      );
    }
    assertRange(curveBase, curveSpan, page.curveWidth * page.curveHeight, glyphPath, 'CURVE_RANGE');
    assertRange(horizontalHeaderBase, horizontalBandCount, page.headerCount, glyphPath, 'HEADER_RANGE');
    assertRange(verticalHeaderBase, verticalBandCount, page.headerCount, glyphPath, 'HEADER_RANGE');
    assertRange(referenceBase, referenceCount, page.referenceCount, glyphPath, 'REFERENCE_RANGE');
    validateHeaderRange(
      page,
      horizontalHeaderBase,
      horizontalBandCount,
      curveBase,
      curveSpan,
      referenceBase,
      referenceCount,
      glyphPath,
    );
    validateHeaderRange(
      page,
      verticalHeaderBase,
      verticalBandCount,
      curveBase,
      curveSpan,
      referenceBase,
      referenceCount,
      glyphPath,
    );
  }
}

function validateHeaderRange(
  page: ValidatedSlugPage,
  headerBase: number,
  headerCount: number,
  curveBase: number,
  curveSpan: number,
  referenceBase: number,
  referenceCount: number,
  path: string,
): void {
  const headers = new DataView(page.headers.bytes.buffer, page.headers.bytes.byteOffset, page.headers.bytes.byteLength);
  const references = new DataView(
    page.references.bytes.buffer,
    page.references.bytes.byteOffset,
    page.references.bytes.byteLength,
  );
  for (let band = 0; band < headerCount; band += 1) {
    const header = headers.getUint32((headerBase + band) * HEADER_BYTES_PER_TEXEL, true);
    const curveCount = header >>> 16;
    const localReferenceOffset = header & 0xffff;
    assertRange(localReferenceOffset, curveCount, referenceCount, path, 'HEADER_REFERENCE_RANGE');
    for (let index = 0; index < curveCount; index += 1) {
      const absoluteReference = referenceBase + localReferenceOffset + index;
      const localCurveOffset = references.getUint16(absoluteReference * REFERENCE_BYTES_PER_TEXEL, true);
      if (localCurveOffset >= curveSpan - 1) {
        fail(
          'CURVE_REFERENCE_RANGE',
          'Slug curve reference must address a complete quadratic inside the glyph curve span',
          path,
        );
      }
      const absoluteCurveTexel = curveBase + localCurveOffset;
      if (absoluteCurveTexel % page.curveWidth === page.curveWidth - 1) {
        fail('CURVE_ROW_BOUNDARY', "Slug curve's first/control texel must not be the final texel of a row", path);
      }
    }
  }
}

function assertRange(base: number, count: number, capacity: number, path: string, code: string): void {
  if (base > capacity || count > capacity - base) {
    fail(code, 'Slug page-relative range exceeds its declared resource count', path);
  }
}

function recordAbsentPayloadIsZero(records: Uint8Array, offset: number): boolean {
  for (let index = 0; index < SLUG_GLYPH_RECORD_STRIDE; index += 1) {
    if ((index === 8 || index === 9) && records[offset + index] === 0xff) continue;
    if (records[offset + index] !== 0) return false;
  }
  return true;
}

function pageGpuBytes(page: ValidatedSlugPage, path: string): number {
  const curveBytes = checkedProduct(
    checkedProduct(page.curveWidth, page.curveHeight, path),
    CURVE_BYTES_PER_TEXEL,
    path,
  );
  return checkedSum(
    checkedSum(curveBytes, page.headers.bytes.byteLength, path),
    page.references.bytes.byteLength,
    path,
  );
}

function validatedResource(resource: ResolvedRasterPageSource): ValidatedSlugResource {
  return {
    bytes: resource.bytes,
    source: resource.source,
    ...(resource.uri === undefined ? {} : { uri: resource.uri }),
  };
}

function resolveLimits(limits: Partial<SlugArtifactValidationLimits> | undefined): SlugArtifactValidationLimits {
  const resolved = {
    maxTextureDimension2D: limits?.maxTextureDimension2D ?? 16_384,
    maxGpuBytes: limits?.maxGpuBytes ?? 256 * 1024 * 1024,
  };
  if (
    !Number.isSafeInteger(resolved.maxTextureDimension2D) ||
    resolved.maxTextureDimension2D < 1 ||
    !Number.isSafeInteger(resolved.maxGpuBytes) ||
    resolved.maxGpuBytes < 1
  ) {
    fail('VALIDATION_LIMIT', 'Slug validation limits must be positive safe integers');
  }
  return resolved;
}
