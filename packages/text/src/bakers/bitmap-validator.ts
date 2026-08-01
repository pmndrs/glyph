import {
  FontArtifactValidationError,
  evaluateExtensionSchema,
  parseGlb,
  validateWithKhronos,
  type KhronosValidationReport,
  type ParsedGlb,
} from '@pmndrs/text-font-baker/validate';
import {
  VK_FORMAT_ASTC_4x4_UNORM_BLOCK,
  VK_FORMAT_BC4_UNORM_BLOCK,
  VK_FORMAT_EAC_R11_UNORM_BLOCK,
  VK_FORMAT_R8_UNORM,
  KHR_DF_CHANNEL_RGBSDA_RED,
} from 'ktx-parse';

import bitmapSchema from './schemas/glTF.PMNDRS_font_bitmap.schema.json' with { type: 'json' };
import sourceSchema from './schemas/resourceSource.PMNDRS_font.schema.json' with { type: 'json' };
import pagesSchema from './schemas/texturePages.PMNDRS_font.schema.json' with { type: 'json' };
import resourceSchema from './schemas/textureResource.PMNDRS_font.schema.json' with { type: 'json' };
import type { RasterKey, Sha256Hex } from '../identity.js';
import {
  RasterArtifactValidationError,
  asArray,
  asInteger,
  asString,
  checkedProduct,
  checkedSum,
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
import {
  BITMAP_EXTENSION,
  BITMAP_FORMAT_VERSION,
  bitmapDescriptorRasterKey,
  canonicalizeBitmapDescriptor,
  type BitmapDescriptorV0,
} from '../internal/bitmap-contract.js';

const RECORD_STRIDE = 20;

const BITMAP_VARIANTS = {
  r8unorm: {
    vkFormat: VK_FORMAT_R8_UNORM,
    blockWidth: 1,
    blockHeight: 1,
    bytesPerBlock: 1,
    uncompressedChannelTypes: [KHR_DF_CHANNEL_RGBSDA_RED],
    requiredFeature: undefined,
    quality: 'lossless',
  },
  'bc4-r-unorm': {
    vkFormat: VK_FORMAT_BC4_UNORM_BLOCK,
    blockWidth: 4,
    blockHeight: 4,
    bytesPerBlock: 8,
    requiredFeature: 'texture-compression-bc',
    quality: 'quality-gated',
  },
  'eac-r11unorm': {
    vkFormat: VK_FORMAT_EAC_R11_UNORM_BLOCK,
    blockWidth: 4,
    blockHeight: 4,
    bytesPerBlock: 8,
    requiredFeature: 'texture-compression-etc2',
    quality: 'quality-gated',
  },
  'astc-4x4-unorm': {
    vkFormat: VK_FORMAT_ASTC_4x4_UNORM_BLOCK,
    blockWidth: 4,
    blockHeight: 4,
    bytesPerBlock: 16,
    requiredFeature: 'texture-compression-astc',
    quality: 'quality-gated',
  },
} as const;

type BitmapGpuFormat = keyof typeof BITMAP_VARIANTS;

export type BitmapArtifactValidationIssue = RasterArtifactValidationIssue;

export interface BitmapArtifactValidationLimits {
  readonly maxTextureDimension2D: number;
  readonly maxGpuBytes: number;
}

export interface BitmapArtifactValidationContext {
  readonly rasterKey: RasterKey | string;
  readonly shapingHash: Sha256Hex | string;
  readonly glyphCount: number;
  readonly coverage?: Uint8Array;
  readonly glyphIdWidth: 16;
  readonly descriptor: BitmapDescriptorV0;
  readonly externalPages?: ReadonlyMap<string, Uint8Array>;
  readonly limits?: Partial<BitmapArtifactValidationLimits>;
}

export interface ValidatedBitmapPageV0 {
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
  readonly source: 'embedded' | 'external';
  readonly uri?: string;
}

export interface ValidatedBitmapStrikeV0 {
  readonly ppem: number;
  readonly planeUnitsPerEm: number;
  readonly records: Uint8Array;
  readonly pages: readonly ValidatedBitmapPageV0[];
}

export interface ValidatedBitmapArtifactV0 {
  readonly document: Readonly<Record<string, unknown>>;
  readonly rasterKey: RasterKey;
  readonly shapingHash: Sha256Hex;
  readonly glyphCount: number;
  readonly strikes: readonly ValidatedBitmapStrikeV0[];
  readonly khronos: KhronosValidationReport;
}

export class BitmapArtifactValidationError extends Error {
  readonly issues: readonly BitmapArtifactValidationIssue[];

  constructor(issues: readonly BitmapArtifactValidationIssue[]) {
    super(
      issues
        .map((issue) => `${issue.code}${issue.path === undefined ? '' : ` ${issue.path}`}: ${issue.message}`)
        .join('\n'),
    );
    this.name = 'BitmapArtifactValidationError';
    this.issues = issues;
  }
}

export async function validateBitmapArtifact(
  bytes: Uint8Array,
  context: BitmapArtifactValidationContext,
): Promise<ValidatedBitmapArtifactV0> {
  try {
    const parsed = parseGlb(bytes);
    const khronos = await validateWithKhronos(bytes, parsed.document);
    return await validateBitmapSemantics(parsed, khronos, context);
  } catch (error) {
    if (error instanceof BitmapArtifactValidationError) throw error;
    if (error instanceof FontArtifactValidationError || error instanceof RasterArtifactValidationError) {
      throw new BitmapArtifactValidationError(error.issues);
    }
    throw error;
  }
}

async function validateBitmapSemantics(
  parsed: ParsedGlb,
  khronos: KhronosValidationReport,
  context: BitmapArtifactValidationContext,
): Promise<ValidatedBitmapArtifactV0> {
  const expectedDescriptor = canonicalizeBitmapDescriptor(context.descriptor.strikes, context.descriptor.coverage);
  if (canonicalJson(context.descriptor) !== canonicalJson(expectedDescriptor)) {
    fail('BITMAP_DESCRIPTOR', 'descriptor is not in canonical bitmap form', '/descriptor');
  }
  const expectedKey = await bitmapDescriptorRasterKey(expectedDescriptor);
  if (context.rasterKey !== expectedKey) {
    fail('RASTER_KEY', 'expected raster key does not match the canonical descriptor', '/rasterKey');
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
  if (!used.includes(BITMAP_EXTENSION) || (!combined && !required.includes(BITMAP_EXTENSION))) {
    fail(
      'BITMAP_EXTENSION_REQUIRED',
      'bitmap GLB must use its extension, and a split companion must require it',
      '/extensionsRequired',
    );
  }
  const extension = requireNonArrayObject(extensions[BITMAP_EXTENSION], `/extensions/${BITMAP_EXTENSION}`);
  const schemaIssues = evaluateExtensionSchema(
    extension,
    withSchemaId(bitmapSchema, 'extensions/PMNDRS_font_bitmap/schema/glTF.PMNDRS_font_bitmap.schema.json'),
    `/extensions/${BITMAP_EXTENSION}`,
    [
      {
        id: 'extensions/schema/resourceSource.PMNDRS_font.schema.json',
        schema: sourceSchema,
      },
      {
        id: 'extensions/schema/textureResource.PMNDRS_font.schema.json',
        schema: resourceSchema,
      },
      {
        id: 'extensions/schema/texturePages.PMNDRS_font.schema.json',
        schema: pagesSchema,
      },
    ],
  );
  if (schemaIssues.length !== 0) throw new BitmapArtifactValidationError(schemaIssues);
  if (
    extension.version !== BITMAP_FORMAT_VERSION ||
    extension.rasterKey !== context.rasterKey ||
    extension.shapingHash !== context.shapingHash ||
    extension.glyphCount !== context.glyphCount ||
    extension.glyphIdWidth !== context.glyphIdWidth
  ) {
    fail(
      'RECIPROCAL_IDENTITY',
      'bitmap extension identity does not match the selected core font/raster binding',
      `/extensions/${BITMAP_EXTENSION}`,
    );
  }

  const views = validateRasterBufferViews(parsed, 'bitmap');
  const claimedViews = new Set<number>();
  if (combined) {
    claimCoreRasterViews(extensions.PMNDRS_font, claimedViews, views.length, BITMAP_EXTENSION, 'bitmap');
  }
  const coverage = validateRasterCoverage(
    parsed,
    extension,
    expectedDescriptor.coverage,
    views,
    claimedViews,
    context.glyphCount,
    `/extensions/${BITMAP_EXTENSION}`,
    'bitmap',
  );
  const strikeValues = asArray(extension.strikes, `/extensions/${BITMAP_EXTENSION}/strikes`);
  if (strikeValues.length !== expectedDescriptor.strikes.length) {
    fail('STRIKE_TUPLE', 'artifact does not contain the exact declared strike tuple');
  }
  const limits = {
    maxTextureDimension2D: context.limits?.maxTextureDimension2D ?? 16_384,
    maxGpuBytes: context.limits?.maxGpuBytes ?? 256 * 1024 * 1024,
  };
  if (
    !Number.isSafeInteger(limits.maxTextureDimension2D) ||
    limits.maxTextureDimension2D < 1 ||
    !Number.isSafeInteger(limits.maxGpuBytes) ||
    limits.maxGpuBytes < 1
  ) {
    fail('VALIDATION_LIMIT', 'bitmap validation limits must be positive safe integers');
  }

  let gpuBytes = 0;
  const strikes: ValidatedBitmapStrikeV0[] = [];
  for (let strikeIndex = 0; strikeIndex < strikeValues.length; strikeIndex += 1) {
    const path = `/extensions/${BITMAP_EXTENSION}/strikes/${strikeIndex}`;
    const strike = requireNonArrayObject(strikeValues[strikeIndex], path);
    const ppem = asInteger(strike.ppemX, `${path}/ppemX`, 1, 65_535);
    if (strike.ppemY !== ppem || ppem !== expectedDescriptor.strikes[strikeIndex]) {
      fail('STRIKE_TUPLE', 'bitmap strikes must be square and in exact canonical order', path);
    }
    const planeUnitsPerEm = asInteger(strike.planeUnitsPerEm, `${path}/planeUnitsPerEm`, 1, 32_767);
    if (strike.recordStride !== RECORD_STRIDE) {
      fail('RECORD_STRIDE', 'bitmap V0 records must use 20-byte stride', `${path}/recordStride`);
    }
    const recordView = asInteger(strike.recordBufferView, `${path}/recordBufferView`, 0, views.length - 1);
    claimRasterView(claimedViews, views, recordView, `${path}/recordBufferView`, 'bitmap');
    const expectedRecordBytes = checkedProduct(context.glyphCount, RECORD_STRIDE, `${path}/records`);
    if (views[recordView]?.byteLength !== expectedRecordBytes) {
      fail('RECORD_LENGTH', 'record view must contain exactly glyphCount × 20 bytes', `${path}/recordBufferView`);
    }
    const pageValues = asArray(strike.pages, `${path}/pages`);
    const pages: ValidatedBitmapPageV0[] = [];
    for (let pageIndex = 0; pageIndex < pageValues.length; pageIndex += 1) {
      const pagePath = `${path}/pages/${pageIndex}`;
      const page = requireNonArrayObject(pageValues[pageIndex], pagePath);
      const width = asInteger(page.width, `${pagePath}/width`, 1, limits.maxTextureDimension2D);
      const height = asInteger(page.height, `${pagePath}/height`, 1, limits.maxTextureDimension2D);
      if (page.mipLevelCount !== 1 || page.colorSpace !== 'linear') {
        fail('PAGE_BASELINE', 'grayscale bitmap V0 pages must be single-level linear resources', pagePath);
      }
      const variants = asArray(page.variants, `${pagePath}/variants`);
      const seenFormats = new Set<string>();
      let baselinePage: ValidatedBitmapPageV0 | undefined;
      for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
        const variantPath = `${pagePath}/variants/${variantIndex}`;
        const variant = requireNonArrayObject(variants[variantIndex], variantPath);
        const gpuFormat = asString(variant.gpuFormat, `${variantPath}/gpuFormat`);
        if (!isBitmapGpuFormat(gpuFormat)) {
          fail(
            'BITMAP_GPU_FORMAT',
            'grayscale bitmap V0 accepts only R8, BC4, EAC R11, or ASTC 4x4 variants',
            `${variantPath}/gpuFormat`,
          );
        }
        if (seenFormats.has(gpuFormat)) {
          fail('VARIANT_DUPLICATE', 'bitmap page contains a duplicate GPU format', variantPath);
        }
        seenFormats.add(gpuFormat);
        const format = BITMAP_VARIANTS[gpuFormat];
        if (
          variant.container !== 'ktx2' ||
          variant.requiredFeature !== format.requiredFeature ||
          variant.quality !== format.quality
        ) {
          fail(
            'VARIANT_CONTRACT',
            'bitmap variant container, feature, or quality does not match its GPU format',
            variantPath,
          );
        }
        const source = requireNonArrayObject(variant.source, `${variantPath}/source`);
        const resource = await resolveRasterPageSource(
          source,
          variantPath,
          parsed,
          views,
          claimedViews,
          context.externalPages,
          'bitmap',
        );
        validateNativeKtx2(resource.bytes, width, height, format, variantPath);
        if (gpuFormat === 'r8unorm') {
          baselinePage = {
            width,
            height,
            bytes: resource.bytes,
            source: resource.source,
            ...(resource.uri === undefined ? {} : { uri: resource.uri }),
          };
        }
      }
      if (baselinePage === undefined) {
        fail('PAGE_BASELINE', 'bitmap page is missing its lossless R8 KTX2 baseline', pagePath);
      }
      gpuBytes = checkedSum(gpuBytes, checkedProduct(width, height, pagePath), pagePath);
      if (gpuBytes > limits.maxGpuBytes) {
        fail('GPU_BUDGET', 'bitmap pages exceed the configured GPU byte budget', pagePath);
      }
      pages.push(baselinePage);
    }
    const records = sliceRasterView(parsed, views[recordView]!);
    validateDenseRasterRecords(records, pages, context.glyphCount, path, 'bitmap');
    validateRasterCoverageRecords(coverage, records, context.glyphCount, path, 'bitmap');
    strikes.push({ ppem, planeUnitsPerEm, records, pages });
  }
  if (combined) {
    claimOtherRasterExtensionViews(extensions, claimedViews, views.length, BITMAP_EXTENSION);
  }
  if (claimedViews.size !== views.length) {
    fail('BUFFER_VIEW_UNCLAIMED', 'bitmap artifact contains an unclaimed buffer view', '/bufferViews');
  }

  return {
    document,
    rasterKey: context.rasterKey as RasterKey,
    shapingHash: context.shapingHash as Sha256Hex,
    glyphCount: context.glyphCount,
    ...(coverage === undefined ? {} : { coverage }),
    strikes,
    khronos,
  };
}

function isBitmapGpuFormat(value: string): value is BitmapGpuFormat {
  return Object.hasOwn(BITMAP_VARIANTS, value);
}
