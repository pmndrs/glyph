import {
  FontArtifactValidationError,
  evaluateExtensionSchema,
  parseGlb,
  validateWithKhronos,
  type KhronosValidationReport,
  type ParsedGlb,
} from '@pmndrs/text-font-baker/validate';
import {
  KHR_DF_CHANNEL_RGBSDA_ALPHA,
  KHR_DF_CHANNEL_RGBSDA_BLUE,
  KHR_DF_CHANNEL_RGBSDA_GREEN,
  KHR_DF_CHANNEL_RGBSDA_RED,
  VK_FORMAT_R8G8B8A8_UNORM,
} from 'ktx-parse';

import msdfSchema from './schemas/glTF.PMNDRS_font_distance_field.schema.json' with { type: 'json' };
import sourceSchema from './schemas/resourceSource.PMNDRS_font.schema.json' with { type: 'json' };
import resourceSchema from './schemas/textureResource.PMNDRS_font.schema.json' with { type: 'json' };
import type { RasterKey, Sha256Hex } from '../identity.js';
import {
  RasterArtifactValidationError,
  asArray,
  asInteger,
  checkedProduct,
  claimCoreRasterViews,
  claimOtherRasterExtensionViews,
  claimRasterView,
  fail,
  isSha256,
  requireNonArrayObject,
  resolveRasterPageSource,
  sliceRasterView,
  stringArray,
  validateDenseRasterRecords,
  validateNativeKtx2,
  validateRasterCoverage,
  validateRasterCoverageRecords,
  validateRasterBufferViews,
  withSchemaId,
  type RasterArtifactValidationIssue,
} from '../internal/raster-artifact-validation.js';
import { canonicalJson } from '../internal/raster-identity.js';
import { normalizeRasterCoverage } from '../raster-coverage.js';
import {
  MSDF_EXTENSION,
  MSDF_FORMAT_VERSION,
  msdfDescriptorConfiguration,
  msdfDescriptor,
  msdfDescriptorRasterKey,
  type MsdfConfiguration,
  type MsdfDescriptorV0,
} from '../internal/msdf-contract.js';

const RECORD_STRIDE = 20;
const BYTES_PER_PIXEL = 4;
const RGBA8_FORMAT = {
  vkFormat: VK_FORMAT_R8G8B8A8_UNORM,
  blockWidth: 1,
  blockHeight: 1,
  bytesPerBlock: BYTES_PER_PIXEL,
  uncompressedChannelTypes: [
    KHR_DF_CHANNEL_RGBSDA_RED,
    KHR_DF_CHANNEL_RGBSDA_GREEN,
    KHR_DF_CHANNEL_RGBSDA_BLUE,
    KHR_DF_CHANNEL_RGBSDA_ALPHA,
  ],
} as const;

export type MtsdfArtifactValidationIssue = RasterArtifactValidationIssue;

export interface MtsdfArtifactValidationLimits {
  readonly maxTextureDimension2D: number;
  readonly maxGpuBytes: number;
}

export interface MtsdfArtifactValidationContext {
  readonly rasterKey: RasterKey | string;
  readonly shapingHash: Sha256Hex | string;
  readonly glyphCount: number;
  readonly glyphIdWidth: 16;
  readonly descriptor: MsdfDescriptorV0;
  readonly externalPages?: ReadonlyMap<string, Uint8Array>;
  readonly limits?: Partial<MtsdfArtifactValidationLimits>;
}

export interface ValidatedMtsdfPageV0 {
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
  readonly source: 'embedded' | 'external';
  readonly uri?: string;
}

export interface ValidatedMtsdfArtifactV0 {
  readonly document: Readonly<Record<string, unknown>>;
  readonly rasterKey: RasterKey;
  readonly shapingHash: Sha256Hex;
  readonly glyphCount: number;
  readonly records: Uint8Array;
  readonly pages: readonly ValidatedMtsdfPageV0[];
  readonly khronos: KhronosValidationReport;
}

export class MtsdfArtifactValidationError extends Error {
  readonly issues: readonly MtsdfArtifactValidationIssue[];

  constructor(issues: readonly MtsdfArtifactValidationIssue[]) {
    super(
      issues
        .map((issue) => `${issue.code}${issue.path === undefined ? '' : ` ${issue.path}`}: ${issue.message}`)
        .join('\n'),
    );
    this.name = 'MtsdfArtifactValidationError';
    this.issues = issues;
  }
}

/** Validate one fixed V0 MTSDF companion before registering or uploading it. */
export async function validateMtsdfArtifact(
  bytes: Uint8Array,
  context: MtsdfArtifactValidationContext,
): Promise<ValidatedMtsdfArtifactV0> {
  try {
    const parsed = parseGlb(bytes);
    const khronos = await validateWithKhronos(bytes, parsed.document);
    return await validateMtsdfSemantics(parsed, khronos, context);
  } catch (error) {
    if (error instanceof MtsdfArtifactValidationError) throw error;
    if (error instanceof FontArtifactValidationError || error instanceof RasterArtifactValidationError) {
      throw new MtsdfArtifactValidationError(error.issues);
    }
    throw error;
  }
}

async function validateMtsdfSemantics(
  parsed: ParsedGlb,
  khronos: KhronosValidationReport,
  context: MtsdfArtifactValidationContext,
): Promise<ValidatedMtsdfArtifactV0> {
  requireNonArrayObject(context.descriptor, '/descriptor');
  let configuration: MsdfConfiguration;
  try {
    configuration = msdfDescriptorConfiguration(context.descriptor);
  } catch {
    fail('MTSDF_DESCRIPTOR', 'descriptor is not a canonical MTSDF generation policy', '/descriptor');
  }
  const descriptorCoverage = normalizeRasterCoverage(context.descriptor.coverage);
  const canonicalDescriptor = msdfDescriptor({
    emSize: configuration.emSize,
    pixelRange: configuration.pixelRange,
    ...(descriptorCoverage === undefined ? {} : { coverage: descriptorCoverage }),
  });
  if (canonicalJson(context.descriptor) !== canonicalJson(canonicalDescriptor)) {
    fail('MTSDF_DESCRIPTOR', 'descriptor is not in canonical MTSDF form', '/descriptor');
  }
  const expectedKey = await msdfDescriptorRasterKey(context.descriptor);
  if (context.rasterKey !== expectedKey) {
    fail('RASTER_KEY', 'expected raster key does not match the MTSDF descriptor', '/rasterKey');
  }
  if (!isSha256(context.shapingHash)) {
    fail('SHAPING_HASH', 'expected shaping hash must be lowercase SHA-256', '/shapingHash');
  }
  if (!Number.isInteger(context.glyphCount) || context.glyphCount < 1 || context.glyphCount > 65_535) {
    fail('GLYPH_COUNT', 'expected glyph count must be in 1..=65535', '/glyphCount');
  }

  const document = parsed.document;
  const used = stringArray(document.extensionsUsed, '/extensionsUsed');
  const required = stringArray(document.extensionsRequired, '/extensionsRequired');
  const extensions = requireNonArrayObject(document.extensions, '/extensions');
  const combined = extensions.PMNDRS_font !== undefined;
  if (!used.includes(MSDF_EXTENSION) || (!combined && !required.includes(MSDF_EXTENSION))) {
    fail(
      'MTSDF_EXTENSION_REQUIRED',
      'MTSDF GLB must use its extension, and a split companion must require it',
      '/extensionsRequired',
    );
  }
  const extensionPath = `/extensions/${MSDF_EXTENSION}`;
  const extension = requireNonArrayObject(extensions[MSDF_EXTENSION], extensionPath);
  const schemaIssues = evaluateExtensionSchema(
    extension,
    withSchemaId(
      msdfSchema,
      'extensions/PMNDRS_font_distance_field/schema/glTF.PMNDRS_font_distance_field.schema.json',
    ),
    extensionPath,
    [
      {
        id: 'extensions/schema/resourceSource.PMNDRS_font.schema.json',
        schema: sourceSchema,
      },
      {
        id: 'extensions/schema/textureResource.PMNDRS_font.schema.json',
        schema: resourceSchema,
      },
    ],
  );
  if (schemaIssues.length !== 0) throw new MtsdfArtifactValidationError(schemaIssues);
  if (
    extension.version !== MSDF_FORMAT_VERSION ||
    extension.rasterKey !== context.rasterKey ||
    extension.shapingHash !== context.shapingHash ||
    extension.glyphCount !== context.glyphCount ||
    extension.glyphIdWidth !== context.glyphIdWidth
  ) {
    fail(
      'RECIPROCAL_IDENTITY',
      'MTSDF extension identity does not match the selected core font/raster binding',
      extensionPath,
    );
  }
  if (
    extension.encoding !== 'mtsdf' ||
    extension.emSize !== configuration.emSize ||
    extension.pixelRange !== configuration.pixelRange ||
    extension.planeUnitsPerEm !== configuration.planeUnitsPerEm ||
    extension.recordStride !== RECORD_STRIDE
  ) {
    fail('MTSDF_CONFIGURATION', 'artifact does not match its MTSDF descriptor', extensionPath);
  }

  const limits = resolveLimits(context.limits);
  const views = validateRasterBufferViews(parsed, 'MTSDF');
  const claimedViews = new Set<number>();
  if (combined) {
    claimCoreRasterViews(extensions.PMNDRS_font, claimedViews, views.length, MSDF_EXTENSION, 'MTSDF');
  }
  const coverage = validateRasterCoverage(
    parsed,
    extension,
    descriptorCoverage,
    views,
    claimedViews,
    context.glyphCount,
    extensionPath,
    'MTSDF',
  );
  const recordView = asInteger(extension.recordBufferView, `${extensionPath}/recordBufferView`, 0, views.length - 1);
  claimRasterView(claimedViews, views, recordView, `${extensionPath}/recordBufferView`, 'MTSDF');
  const expectedRecordBytes = checkedProduct(context.glyphCount, RECORD_STRIDE, `${extensionPath}/records`);
  if (views[recordView]?.byteLength !== expectedRecordBytes) {
    fail(
      'RECORD_LENGTH',
      'record view must contain exactly glyphCount × 20 bytes',
      `${extensionPath}/recordBufferView`,
    );
  }

  let textureArrayWidth = 0;
  let textureArrayHeight = 0;
  const pages: ValidatedMtsdfPageV0[] = [];
  const pageValues = asArray(extension.pages, `${extensionPath}/pages`);
  for (let pageIndex = 0; pageIndex < pageValues.length; pageIndex += 1) {
    const pagePath = `${extensionPath}/pages/${pageIndex}`;
    const page = requireNonArrayObject(pageValues[pageIndex], pagePath);
    const width = asInteger(page.width, `${pagePath}/width`, 1, limits.maxTextureDimension2D);
    const height = asInteger(page.height, `${pagePath}/height`, 1, limits.maxTextureDimension2D);
    textureArrayWidth = Math.max(textureArrayWidth, width);
    textureArrayHeight = Math.max(textureArrayHeight, height);
    if (page.mipLevelCount !== 1 || page.colorSpace !== 'linear') {
      fail('PAGE_BASELINE', 'MTSDF V0 pages must be single-level linear resources', pagePath);
    }
    const variants = asArray(page.variants, `${pagePath}/variants`);
    if (variants.length !== 1) {
      fail('VARIANT_COUNT', 'MTSDF V0 pages must contain exactly one variant', `${pagePath}/variants`);
    }
    const variantPath = `${pagePath}/variants/0`;
    const variant = requireNonArrayObject(variants[0], variantPath);
    if (
      variant.container !== 'ktx2' ||
      variant.gpuFormat !== 'rgba8unorm' ||
      variant.requiredFeature !== undefined ||
      variant.quality !== 'lossless'
    ) {
      fail('VARIANT_CONTRACT', 'MTSDF V0 requires one lossless native RGBA8 KTX2 variant', variantPath);
    }
    const source = requireNonArrayObject(variant.source, `${variantPath}/source`);
    const resource = await resolveRasterPageSource(
      source,
      variantPath,
      parsed,
      views,
      claimedViews,
      context.externalPages,
      'MTSDF',
    );
    validateNativeKtx2(resource.bytes, width, height, RGBA8_FORMAT, variantPath);
    pages.push({
      width,
      height,
      bytes: resource.bytes,
      source: resource.source,
      ...(resource.uri === undefined ? {} : { uri: resource.uri }),
    });
  }

  const gpuBytes = checkedProduct(
    checkedProduct(textureArrayWidth, textureArrayHeight, `${extensionPath}/pages`),
    checkedProduct(pages.length, BYTES_PER_PIXEL, `${extensionPath}/pages`),
    `${extensionPath}/pages`,
  );
  if (gpuBytes > limits.maxGpuBytes) {
    fail(
      'GPU_BUDGET',
      'MTSDF padded base texture array exceeds the configured GPU byte budget',
      `${extensionPath}/pages`,
    );
  }

  const records = sliceRasterView(parsed, views[recordView]!);
  validateDenseRasterRecords(records, pages, context.glyphCount, extensionPath, 'MTSDF', true);
  validateRasterCoverageRecords(coverage, records, context.glyphCount, extensionPath, 'MTSDF');
  if (combined) {
    claimOtherRasterExtensionViews(extensions, claimedViews, views.length, MSDF_EXTENSION);
  }
  if (claimedViews.size !== views.length) {
    fail('BUFFER_VIEW_UNCLAIMED', 'MTSDF artifact contains an unclaimed buffer view', '/bufferViews');
  }

  return {
    document,
    rasterKey: context.rasterKey as RasterKey,
    shapingHash: context.shapingHash as Sha256Hex,
    glyphCount: context.glyphCount,
    ...(coverage === undefined ? {} : { coverage }),
    records,
    pages,
    khronos,
  };
}

function resolveLimits(limits: Partial<MtsdfArtifactValidationLimits> | undefined): MtsdfArtifactValidationLimits {
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
    fail('VALIDATION_LIMIT', 'MTSDF validation limits must be positive safe integers');
  }
  return resolved;
}
