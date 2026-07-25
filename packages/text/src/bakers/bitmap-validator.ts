import {
  FontArtifactValidationError,
  evaluateExtensionSchema,
  parseGlb,
  validateWithKhronos,
  type KhronosValidationReport,
  type ParsedGlb,
} from '@pmndrs/text-font-baker/validate'
import {
  KHR_SUPERCOMPRESSION_NONE,
  VK_FORMAT_ASTC_4x4_UNORM_BLOCK,
  VK_FORMAT_BC4_UNORM_BLOCK,
  VK_FORMAT_EAC_R11_UNORM_BLOCK,
  VK_FORMAT_R8_UNORM,
  read as readKtx2,
  type KTX2Container,
} from 'ktx-parse'

import bitmapSchema from './schemas/glTF.PMNDRS_font_bitmap.schema.json' with { type: 'json' }
import sourceSchema from './schemas/resourceSource.PMNDRS_font.schema.json' with { type: 'json' }
import pagesSchema from './schemas/texturePages.PMNDRS_font.schema.json' with { type: 'json' }
import resourceSchema from './schemas/textureResource.PMNDRS_font.schema.json' with { type: 'json' }
import type { RasterKey, Sha256Hex } from '../identity.js'
import {
  BITMAP_EXTENSION,
  BITMAP_FORMAT_VERSION,
  bitmapDescriptorRasterKey,
  canonicalizeBitmapDescriptor,
  type BitmapDescriptorV0,
} from '../raster/bitmap.js'

const RECORD_STRIDE = 20
const ABSENT_PAGE = 0xffff

const BITMAP_VARIANTS = {
  r8unorm: {
    vkFormat: VK_FORMAT_R8_UNORM,
    blockWidth: 1,
    blockHeight: 1,
    bytesPerBlock: 1,
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
} as const

type BitmapGpuFormat = keyof typeof BITMAP_VARIANTS

export interface BitmapArtifactValidationIssue {
  readonly code: string
  readonly message: string
  readonly path?: string
}

export interface BitmapArtifactValidationLimits {
  readonly maxTextureDimension2D: number
  readonly maxGpuBytes: number
}

export interface BitmapArtifactValidationContext {
  readonly rasterKey: RasterKey | string
  readonly shapingHash: Sha256Hex | string
  readonly glyphCount: number
  readonly glyphIdWidth: 16
  readonly descriptor: BitmapDescriptorV0
  readonly externalPages?: ReadonlyMap<string, Uint8Array>
  readonly limits?: Partial<BitmapArtifactValidationLimits>
}

export interface ValidatedBitmapPageV0 {
  readonly width: number
  readonly height: number
  readonly bytes: Uint8Array
  readonly source: 'embedded' | 'external'
  readonly uri?: string
}

export interface ValidatedBitmapStrikeV0 {
  readonly ppem: number
  readonly planeUnitsPerEm: number
  readonly records: Uint8Array
  readonly pages: readonly ValidatedBitmapPageV0[]
}

export interface ValidatedBitmapArtifactV0 {
  readonly document: Readonly<Record<string, unknown>>
  readonly rasterKey: RasterKey
  readonly shapingHash: Sha256Hex
  readonly glyphCount: number
  readonly strikes: readonly ValidatedBitmapStrikeV0[]
  readonly khronos: KhronosValidationReport
}

export class BitmapArtifactValidationError extends Error {
  readonly issues: readonly BitmapArtifactValidationIssue[]

  constructor(issues: readonly BitmapArtifactValidationIssue[]) {
    super(
      issues
        .map(
          (issue) =>
            `${issue.code}${issue.path === undefined ? '' : ` ${issue.path}`}: ${issue.message}`,
        )
        .join('\n'),
    )
    this.name = 'BitmapArtifactValidationError'
    this.issues = issues
  }
}

export async function validateBitmapArtifact(
  bytes: Uint8Array,
  context: BitmapArtifactValidationContext,
): Promise<ValidatedBitmapArtifactV0> {
  let parsed: ParsedGlb
  let khronos: KhronosValidationReport
  try {
    parsed = parseGlb(bytes)
    khronos = await validateWithKhronos(bytes, parsed.document)
  } catch (error) {
    if (error instanceof FontArtifactValidationError) {
      throw new BitmapArtifactValidationError(error.issues)
    }
    throw error
  }
  return validateBitmapSemantics(parsed, khronos, context)
}

async function validateBitmapSemantics(
  parsed: ParsedGlb,
  khronos: KhronosValidationReport,
  context: BitmapArtifactValidationContext,
): Promise<ValidatedBitmapArtifactV0> {
  const expectedDescriptor = canonicalizeBitmapDescriptor(context.descriptor.strikes)
  if (
    context.descriptor.generatorVersion !== expectedDescriptor.generatorVersion ||
    !equalNumbers(context.descriptor.strikes, expectedDescriptor.strikes)
  ) {
    fail('BITMAP_DESCRIPTOR', 'descriptor is not in canonical bitmap form', '/descriptor')
  }
  const expectedKey = await bitmapDescriptorRasterKey(expectedDescriptor)
  if (context.rasterKey !== expectedKey) {
    fail('RASTER_KEY', 'expected raster key does not match the canonical descriptor', '/rasterKey')
  }
  if (!isHash(context.shapingHash)) {
    fail('SHAPING_HASH', 'expected shaping hash must be lowercase SHA-256', '/shapingHash')
  }
  if (
    !Number.isInteger(context.glyphCount) ||
    context.glyphCount < 1 ||
    context.glyphCount > 65_535
  ) {
    fail('GLYPH_COUNT', 'expected glyph count must be in 1..=65535', '/glyphCount')
  }

  const document = parsed.document
  const used = stringArray(document.extensionsUsed, '/extensionsUsed')
  const required = stringArray(document.extensionsRequired, '/extensionsRequired')
  const extensions = requireNonArrayObject(document.extensions, '/extensions')
  const combined = extensions.PMNDRS_font !== undefined
  if (!used.includes(BITMAP_EXTENSION) || (!combined && !required.includes(BITMAP_EXTENSION))) {
    fail(
      'BITMAP_EXTENSION_REQUIRED',
      'bitmap GLB must use its extension, and a split companion must require it',
      '/extensionsRequired',
    )
  }
  const extension = requireNonArrayObject(extensions[BITMAP_EXTENSION], `/extensions/${BITMAP_EXTENSION}`)
  const schemaIssues = evaluateExtensionSchema(
    extension,
    withId(
      bitmapSchema,
      'extensions/PMNDRS_font_bitmap/schema/glTF.PMNDRS_font_bitmap.schema.json',
    ),
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
  )
  if (schemaIssues.length !== 0) throw new BitmapArtifactValidationError(schemaIssues)
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
    )
  }

  const views = validateBufferViews(parsed)
  const claimedViews = new Set<number>()
  if (combined) claimCoreViews(extensions.PMNDRS_font, claimedViews, views.length)
  const strikeValues = asArray(extension.strikes, `/extensions/${BITMAP_EXTENSION}/strikes`)
  if (strikeValues.length !== expectedDescriptor.strikes.length) {
    fail('STRIKE_TUPLE', 'artifact does not contain the exact declared strike tuple')
  }
  const limits = {
    maxTextureDimension2D: context.limits?.maxTextureDimension2D ?? 16_384,
    maxGpuBytes: context.limits?.maxGpuBytes ?? 256 * 1024 * 1024,
  }
  if (
    !Number.isSafeInteger(limits.maxTextureDimension2D) ||
    limits.maxTextureDimension2D < 1 ||
    !Number.isSafeInteger(limits.maxGpuBytes) ||
    limits.maxGpuBytes < 1
  ) {
    fail('VALIDATION_LIMIT', 'bitmap validation limits must be positive safe integers')
  }

  let gpuBytes = 0
  const strikes: ValidatedBitmapStrikeV0[] = []
  for (let strikeIndex = 0; strikeIndex < strikeValues.length; strikeIndex += 1) {
    const path = `/extensions/${BITMAP_EXTENSION}/strikes/${strikeIndex}`
    const strike = requireNonArrayObject(strikeValues[strikeIndex], path)
    const ppem = asInteger(strike.ppemX, `${path}/ppemX`, 1, 65_535)
    if (strike.ppemY !== ppem || ppem !== expectedDescriptor.strikes[strikeIndex]) {
      fail('STRIKE_TUPLE', 'bitmap strikes must be square and in exact canonical order', path)
    }
    const planeUnitsPerEm = asInteger(strike.planeUnitsPerEm, `${path}/planeUnitsPerEm`, 1, 32_767)
    if (strike.recordStride !== RECORD_STRIDE) {
      fail('RECORD_STRIDE', 'bitmap V0 records must use 20-byte stride', `${path}/recordStride`)
    }
    const recordView = asInteger(
      strike.recordBufferView,
      `${path}/recordBufferView`,
      0,
      views.length - 1,
    )
    claimView(claimedViews, views, recordView, `${path}/recordBufferView`)
    const expectedRecordBytes = checkedProduct(context.glyphCount, RECORD_STRIDE, `${path}/records`)
    if (views[recordView]?.byteLength !== expectedRecordBytes) {
      fail(
        'RECORD_LENGTH',
        'record view must contain exactly glyphCount × 20 bytes',
        `${path}/recordBufferView`,
      )
    }
    const pageValues = asArray(strike.pages, `${path}/pages`)
    const pages: ValidatedBitmapPageV0[] = []
    for (let pageIndex = 0; pageIndex < pageValues.length; pageIndex += 1) {
      const pagePath = `${path}/pages/${pageIndex}`
      const page = requireNonArrayObject(pageValues[pageIndex], pagePath)
      const width = asInteger(page.width, `${pagePath}/width`, 1, limits.maxTextureDimension2D)
      const height = asInteger(page.height, `${pagePath}/height`, 1, limits.maxTextureDimension2D)
      if (page.mipLevelCount !== 1 || page.colorSpace !== 'linear') {
        fail(
          'PAGE_BASELINE',
          'grayscale bitmap V0 pages must be single-level linear resources',
          pagePath,
        )
      }
      const variants = asArray(page.variants, `${pagePath}/variants`)
      const seenFormats = new Set<string>()
      let baselinePage: ValidatedBitmapPageV0 | undefined
      for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
        const variantPath = `${pagePath}/variants/${variantIndex}`
        const variant = requireNonArrayObject(variants[variantIndex], variantPath)
        const gpuFormat = asString(variant.gpuFormat, `${variantPath}/gpuFormat`)
        if (!isBitmapGpuFormat(gpuFormat)) {
          fail(
            'BITMAP_GPU_FORMAT',
            'grayscale bitmap V0 accepts only R8, BC4, EAC R11, or ASTC 4x4 variants',
            `${variantPath}/gpuFormat`,
          )
        }
        if (seenFormats.has(gpuFormat)) {
          fail('VARIANT_DUPLICATE', 'bitmap page contains a duplicate GPU format', variantPath)
        }
        seenFormats.add(gpuFormat)
        const format = BITMAP_VARIANTS[gpuFormat]
        if (
          variant.container !== 'ktx2' ||
          variant.requiredFeature !== format.requiredFeature ||
          variant.quality !== format.quality
        ) {
          fail(
            'VARIANT_CONTRACT',
            'bitmap variant container, feature, or quality does not match its GPU format',
            variantPath,
          )
        }
        const source = requireNonArrayObject(variant.source, `${variantPath}/source`)
        const resource = await resolvePageSource(
          source,
          variantPath,
          parsed,
          views,
          claimedViews,
          context,
        )
        validateKtx2(resource.bytes, width, height, gpuFormat, variantPath)
        if (gpuFormat === 'r8unorm') {
          baselinePage = {
            width,
            height,
            bytes: resource.bytes,
            source: resource.source,
            ...(resource.uri === undefined ? {} : { uri: resource.uri }),
          }
        }
      }
      if (baselinePage === undefined) {
        fail('PAGE_BASELINE', 'bitmap page is missing its lossless R8 KTX2 baseline', pagePath)
      }
      gpuBytes = checkedSum(gpuBytes, checkedProduct(width, height, pagePath), pagePath)
      if (gpuBytes > limits.maxGpuBytes) {
        fail('GPU_BUDGET', 'bitmap pages exceed the configured GPU byte budget', pagePath)
      }
      pages.push(baselinePage)
    }
    const records = sliceView(parsed, views[recordView]!)
    validateRecords(records, pages, context.glyphCount, path)
    strikes.push({ ppem, planeUnitsPerEm, records, pages })
  }
  if (combined) claimOtherExtensionViews(extensions, claimedViews, views.length)
  if (claimedViews.size !== views.length) {
    fail(
      'BUFFER_VIEW_UNCLAIMED',
      'bitmap artifact contains an unclaimed buffer view',
      '/bufferViews',
    )
  }

  return {
    document,
    rasterKey: context.rasterKey as RasterKey,
    shapingHash: context.shapingHash as Sha256Hex,
    glyphCount: context.glyphCount,
    strikes,
    khronos,
  }
}

interface BufferView {
  readonly byteOffset: number
  readonly byteLength: number
  readonly byteStride?: unknown
  readonly target?: unknown
}

function validateBufferViews(parsed: ParsedGlb): readonly BufferView[] {
  const values = asArray(parsed.document.bufferViews, '/bufferViews')
  const views = values.map((value, index) => {
    const path = `/bufferViews/${index}`
    const view = requireNonArrayObject(value, path)
    if (view.buffer !== 0) fail('BUFFER_VIEW_CONTRACT', 'buffer view must reference buffer 0', path)
    const byteOffset =
      view.byteOffset === undefined ? 0 : asInteger(view.byteOffset, `${path}/byteOffset`, 0)
    const byteLength = asInteger(view.byteLength, `${path}/byteLength`, 1)
    if (byteOffset % 4 !== 0 || byteOffset > parsed.declaredBinLength - byteLength) {
      fail('BUFFER_VIEW_RANGE', 'bitmap buffer view is misaligned or outside the BIN range', path)
    }
    return {
      byteOffset,
      byteLength,
      ...(view.byteStride === undefined ? {} : { byteStride: view.byteStride }),
      ...(view.target === undefined ? {} : { target: view.target }),
    }
  })
  const sorted = [...views].sort((left, right) => left.byteOffset - right.byteOffset)
  let end = 0
  for (const view of sorted) {
    if (view.byteOffset < end) fail('BUFFER_VIEW_OVERLAP', 'bitmap buffer views overlap')
    if (!allZero(parsed.bin.subarray(end, view.byteOffset))) {
      fail('BUFFER_VIEW_GAP', 'bitmap buffer-view alignment gaps must be zero')
    }
    end = view.byteOffset + view.byteLength
  }
  if (!allZero(parsed.bin.subarray(end, parsed.declaredBinLength))) {
    fail('BUFFER_TRAILING_DATA', 'bitmap BIN has unclaimed nonzero trailing data')
  }
  return views
}

function validateRecords(
  records: Uint8Array,
  pages: readonly ValidatedBitmapPageV0[],
  glyphCount: number,
  path: string,
): void {
  const view = new DataView(records.buffer, records.byteOffset, records.byteLength)
  for (let glyphId = 0; glyphId < glyphCount; glyphId += 1) {
    const offset = glyphId * RECORD_STRIDE
    const page = view.getUint16(offset + 16, true)
    const flags = view.getUint16(offset + 18, true)
    if (flags !== 0)
      fail('RECORD_FLAGS', 'bitmap V0 record flags must be zero', `${path}/records/${glyphId}`)
    if (page === ABSENT_PAGE) {
      if (!allZero(records.subarray(offset, offset + 16))) {
        fail(
          'RECORD_ABSENT_DATA',
          'absent bitmap records must zero every field except the page sentinel',
          `${path}/records/${glyphId}`,
        )
      }
      continue
    }
    const resource = pages[page]
    if (resource === undefined) {
      fail(
        'RECORD_PAGE',
        'bitmap record references a missing logical page',
        `${path}/records/${glyphId}`,
      )
    }
    const planeLeft = view.getInt16(offset, true)
    const planeBottom = view.getInt16(offset + 2, true)
    const planeRight = view.getInt16(offset + 4, true)
    const planeTop = view.getInt16(offset + 6, true)
    const atlasLeft = view.getUint16(offset + 8, true)
    const atlasTop = view.getUint16(offset + 10, true)
    const atlasRight = view.getUint16(offset + 12, true)
    const atlasBottom = view.getUint16(offset + 14, true)
    if (planeLeft > planeRight || planeBottom > planeTop) {
      fail('RECORD_PLANE_BOUNDS', 'bitmap plane bounds are inverted', `${path}/records/${glyphId}`)
    }
    if (
      atlasLeft >= atlasRight ||
      atlasTop >= atlasBottom ||
      atlasRight > resource.width ||
      atlasBottom > resource.height
    ) {
      fail(
        'RECORD_ATLAS_BOUNDS',
        'bitmap atlas bounds exceed their logical page',
        `${path}/records/${glyphId}`,
      )
    }
  }
}

async function resolvePageSource(
  source: Record<string, unknown>,
  path: string,
  parsed: ParsedGlb,
  views: readonly BufferView[],
  claimedViews: Set<number>,
  context: BitmapArtifactValidationContext,
): Promise<{ bytes: Uint8Array; source: 'embedded' | 'external'; uri?: string }> {
  if (source.type === 'bufferView') {
    const viewIndex = asInteger(source.bufferView, `${path}/source/bufferView`, 0, views.length - 1)
    claimView(claimedViews, views, viewIndex, `${path}/source/bufferView`)
    return { bytes: sliceView(parsed, views[viewIndex]!), source: 'embedded' }
  }
  if (source.type === 'external') {
    const uri = asString(source.uri, `${path}/source/uri`)
    const bytes =
      context.externalPages?.get(uri) ??
      fail(
        'EXTERNAL_PAGE_MISSING',
        `external page ${uri} was not supplied for validation`,
        `${path}/source/uri`,
      )
    if (source.byteLength !== bytes.byteLength) {
      fail('EXTERNAL_PAGE_LENGTH', 'external page byte length does not match its directory', path)
    }
    const actualHash = await sha256(bytes)
    if (source.artifactHash !== actualHash) {
      fail('EXTERNAL_PAGE_HASH', 'external page hash does not match its directory', path)
    }
    return { bytes, source: 'external', uri }
  }
  fail('PAGE_SOURCE', 'bitmap page source must be embedded or external', path)
}

function validateKtx2(
  bytes: Uint8Array,
  width: number,
  height: number,
  gpuFormat: BitmapGpuFormat,
  path: string,
): void {
  let container: KTX2Container
  try {
    container = readKtx2(bytes)
  } catch (error) {
    fail('KTX2_INVALID', error instanceof Error ? error.message : String(error), path)
  }
  const format = BITMAP_VARIANTS[gpuFormat]
  const horizontalBlocks = Math.ceil(width / format.blockWidth)
  const verticalBlocks = Math.ceil(height / format.blockHeight)
  const expectedBytes = checkedProduct(
    checkedProduct(horizontalBlocks, verticalBlocks, path),
    format.bytesPerBlock,
    path,
  )
  if (
    container.vkFormat !== format.vkFormat ||
    container.typeSize !== 1 ||
    container.pixelWidth !== width ||
    container.pixelHeight !== height ||
    container.pixelDepth !== 0 ||
    container.layerCount !== 0 ||
    container.faceCount !== 1 ||
    container.levelCount !== 1 ||
    container.supercompressionScheme !== KHR_SUPERCOMPRESSION_NONE ||
    container.levels.length !== 1 ||
    container.levels[0]?.levelData.byteLength !== expectedBytes ||
    container.levels[0]?.uncompressedByteLength !== expectedBytes
  ) {
    fail(
      'KTX2_VARIANT',
      'KTX2 must be an uncompressed single-level native image matching its declared dimensions and GPU format',
      path,
    )
  }
}

function isBitmapGpuFormat(value: string): value is BitmapGpuFormat {
  return Object.hasOwn(BITMAP_VARIANTS, value)
}

function withId(
  schema: Readonly<Record<string, unknown>>,
  id: string,
): Readonly<Record<string, unknown>> {
  return { ...schema, $id: id }
}

function sliceView(parsed: ParsedGlb, view: BufferView): Uint8Array {
  return parsed.bin.subarray(view.byteOffset, view.byteOffset + view.byteLength)
}

function claimView(
  claimed: Set<number>,
  views: readonly BufferView[],
  index: number,
  path: string,
): void {
  if (claimed.has(index))
    fail('BUFFER_VIEW_ALIAS', 'bitmap resources must use distinct views', path)
  const view = views[index]
  if (view?.byteStride !== undefined || view?.target !== undefined) {
    fail('BUFFER_VIEW_CONTRACT', 'bitmap buffer views must omit byteStride and target', path)
  }
  claimed.add(index)
}

function claimCoreViews(value: unknown, claimed: Set<number>, viewCount: number): void {
  const font = requireNonArrayObject(value, '/extensions/PMNDRS_font')
  const shaping = requireNonArrayObject(font.shaping, '/extensions/PMNDRS_font/shaping')
  const functions = requireNonArrayObject(shaping.fontFunctions, '/extensions/PMNDRS_font/shaping/fontFunctions')
  for (const [candidate, path] of [
    [shaping.bufferView, '/extensions/PMNDRS_font/shaping/bufferView'],
    [
      functions.glyphExtentsBufferView,
      '/extensions/PMNDRS_font/shaping/fontFunctions/glyphExtentsBufferView',
    ],
    [
      functions.glyphExtentsAvailabilityBufferView,
      '/extensions/PMNDRS_font/shaping/fontFunctions/glyphExtentsAvailabilityBufferView',
    ],
  ] as const) {
    const index = asInteger(candidate, path, 0, viewCount - 1)
    if (claimed.has(index))
      fail('CORE_BUFFER_VIEW_ALIAS', 'core font buffer views must be distinct', path)
    claimed.add(index)
  }
  const rasters = asArray(font.rasters, '/extensions/PMNDRS_font/rasters')
  const matches = rasters.filter((entry) => {
    const raster = requireNonArrayObject(entry, '/extensions/PMNDRS_font/rasters')
    const source = requireNonArrayObject(raster.source, '/extensions/PMNDRS_font/rasters/source')
    return raster.extension === BITMAP_EXTENSION && source.type === 'embedded'
  })
  if (matches.length !== 1) {
    fail(
      'BITMAP_DIRECTORY',
      'combined font GLB must contain exactly one embedded bitmap directory entry',
      '/extensions/PMNDRS_font/rasters',
    )
  }
}

function claimOtherExtensionViews(
  extensions: Readonly<Record<string, unknown>>,
  claimed: Set<number>,
  viewCount: number,
): void {
  for (const [name, extension] of Object.entries(extensions)) {
    if (name === 'PMNDRS_font' || name === BITMAP_EXTENSION) continue
    visit(extension, `/extensions/${name}`)
  }

  function visit(value: unknown, path: string): void {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}/${index}`))
      return
    }
    if (typeof value !== 'object' || value === null) return
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}/${key}`
      if (key === 'bufferView' || key.endsWith('BufferView')) {
        const index = asInteger(child, childPath, 0, viewCount - 1)
        if (claimed.has(index)) {
          fail(
            'BUFFER_VIEW_ALIAS',
            'companion extensions must own distinct buffer views',
            childPath,
          )
        }
        claimed.add(index)
      } else {
        visit(child, childPath)
      }
    }
  }
}

function equalNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function requireNonArrayObject(value: unknown, path: string): Record<string, unknown> {
  assertNonArrayObject(value, path)
  return value
}

function assertNonArrayObject(
  value: unknown,
  path: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('TYPE_OBJECT', 'value must be an object', path)
  }
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail('TYPE_ARRAY', 'value must be an array', path)
  return value
}

function asString(value: unknown, path: string): string {
  if (typeof value !== 'string') fail('TYPE_STRING', 'value must be a string', path)
  return value
}

function stringArray(value: unknown, path: string): string[] {
  return asArray(value, path).map((entry, index) => asString(entry, `${path}/${index}`))
}

function asInteger(
  value: unknown,
  path: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail('TYPE_INTEGER', `value must be an integer in ${minimum}..=${maximum}`, path)
  }
  return value
}

function checkedProduct(left: number, right: number, path: string): number {
  const value = left * right
  if (!Number.isSafeInteger(value)) fail('ARITHMETIC_OVERFLOW', 'integer product overflowed', path)
  return value
}

function checkedSum(left: number, right: number, path: string): number {
  const value = left + right
  if (!Number.isSafeInteger(value)) fail('ARITHMETIC_OVERFLOW', 'integer sum overflowed', path)
  return value
}

function allZero(bytes: Uint8Array): boolean {
  return bytes.every((value) => value === 0)
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function fail(code: string, message: string, path?: string): never {
  throw new BitmapArtifactValidationError([
    { code, message, ...(path === undefined ? {} : { path }) },
  ])
}
