import type { FontBakeResultV0 } from '@pmndrs/text-font-baker'
import { parseGlb } from '@pmndrs/text-font-baker/validate'

import type {
  BakeArtifactV0,
  BakeWarning,
  FontPayloadReport,
  RasterBakeArtifact,
  RasterPackagingV0,
} from '../bake.js'
import type { Sha256Hex } from '../identity.js'

export interface RasterCompositionV0 {
  readonly raster: RasterBakeArtifact
  readonly packaging: RasterPackagingV0
}

export interface ComposedFontBakeResultV0 {
  readonly artifacts: readonly BakeArtifactV0[]
  readonly report: FontPayloadReport
  readonly warnings: readonly BakeWarning[]
}

export class BakeCompositionError extends Error {
  readonly code: string
  readonly path: string | undefined

  constructor(code: string, message: string, path?: string) {
    super(message)
    this.name = 'BakeCompositionError'
    this.code = code
    this.path = path
  }
}

/** Compose package-owned raster artifacts without interpreting companion semantics. */
export async function composeFontBake(
  core: FontBakeResultV0,
  rasters: readonly RasterCompositionV0[],
): Promise<ComposedFontBakeResultV0> {
  const coreArtifact = exactlyOne(
    core.artifacts.filter(({ role }) => role === 'font'),
    'CORE_ARTIFACT',
    'font bake result must contain exactly one font artifact',
  )
  await authenticateArtifact(coreArtifact, '/core/artifacts/0')
  if (rasters.length === 0) {
    return {
      artifacts: [asArtifact(coreArtifact)],
      report: mapReport(core, [], [asArtifact(coreArtifact)]),
      warnings: core.warnings,
    }
  }

  const parsedCore = parseGlb(coreArtifact.bytes)
  const document = structuredClone(parsedCore.document)
  const extensions = requireNonArrayObject(document.extensions, '/extensions')
  const font = requireNonArrayObject(extensions.PMNDRS_font, '/extensions/PMNDRS_font')
  const shaping = requireNonArrayObject(font.shaping, '/extensions/PMNDRS_font/shaping')
  const metrics = requireNonArrayObject(font.metrics, '/extensions/PMNDRS_font/metrics')
  const shapingHash = asHash(shaping.hash, '/extensions/PMNDRS_font/shaping/hash')
  const glyphCount = asInteger(metrics.glyphCount, '/extensions/PMNDRS_font/metrics/glyphCount')
  const glyphIdWidth = asInteger(
    metrics.glyphIdWidth,
    '/extensions/PMNDRS_font/metrics/glyphIdWidth',
  )
  if (glyphIdWidth !== 16) fail('GLYPH_ID_WIDTH', 'V0 composition requires 16-bit glyph IDs')

  const directory = asArray(font.rasters, '/extensions/PMNDRS_font/rasters')
  if (directory.length !== 0) {
    fail('CORE_ALREADY_COMPOSED', 'composition input must be the shaping-only core artifact')
  }
  const used = stringArray(document.extensionsUsed, '/extensionsUsed')
  const required = stringArray(document.extensionsRequired, '/extensionsRequired')
  const views = asArray(document.bufferViews, '/bufferViews')
  const binaryParts: Uint8Array[] = [parsedCore.bin.subarray(0, parsedCore.declaredBinLength)]
  let binaryLength = parsedCore.declaredBinLength
  const rasterKeys = new Set<string>()
  const embeddedExtensions = new Set<string>()
  const outputArtifacts: BakeArtifactV0[] = []

  for (let index = 0; index < rasters.length; index += 1) {
    const { raster, packaging } = rasters[index]!
    const path = `/rasters/${index}`
    if (rasterKeys.has(raster.rasterKey)) {
      fail(
        'RASTER_KEY_DUPLICATE',
        'composition contains a duplicate raster key',
        `${path}/rasterKey`,
      )
    }
    rasterKeys.add(raster.rasterKey)
    const main = exactlyOne(
      raster.artifacts.filter(({ role }) => role === 'raster'),
      'RASTER_ARTIFACT',
      'raster bake result must contain exactly one companion artifact',
      `${path}/artifacts`,
    )
    if (raster.artifacts.some(({ role }) => role !== 'raster' && role !== 'raster-page')) {
      fail(
        'RASTER_ARTIFACT_ROLE',
        'raster results may contain only one raster index and raster-page artifacts',
        `${path}/artifacts`,
      )
    }
    if (
      packaging.pages === 'embedded' &&
      raster.artifacts.some(({ role }) => role === 'raster-page')
    ) {
      fail(
        'RASTER_PAGE_PACKAGING',
        'embedded page packaging must not emit independent raster-page artifacts',
        `${path}/artifacts`,
      )
    }
    for (let artifactIndex = 0; artifactIndex < raster.artifacts.length; artifactIndex += 1) {
      await authenticateArtifact(
        raster.artifacts[artifactIndex]!,
        `${path}/artifacts/${artifactIndex}`,
      )
    }
    const parsedRaster = parseGlb(main.bytes)
    const rasterExtensions = requireNonArrayObject(parsedRaster.document.extensions, `${path}/extensions`)
    const extensionData = requireNonArrayObject(
      rasterExtensions[raster.extension],
      `${path}/extensions/${raster.extension}`,
    )
    assertRasterIdentity(
      extensionData,
      raster,
      shapingHash,
      glyphCount,
      glyphIdWidth,
      `${path}/extensions/${raster.extension}`,
    )

    if (packaging.artifact === 'external') {
      directory.push({
        rasterKey: raster.rasterKey,
        kind: raster.kind,
        extension: raster.extension,
        version: raster.version,
        source: { type: 'external', uri: main.id, artifactHash: main.sha256 },
      })
      outputArtifacts.push(...raster.artifacts.map(asArtifact))
      continue
    }

    if (embeddedExtensions.has(raster.extension) || extensions[raster.extension] !== undefined) {
      fail(
        'RASTER_EXTENSION_DUPLICATE',
        'only one raster may be embedded for each companion extension',
        `${path}/extension`,
      )
    }
    embeddedExtensions.add(raster.extension)
    const rasterViews = asArray(parsedRaster.document.bufferViews, `${path}/bufferViews`)
    const viewBase = views.length
    const binaryBase = align4(binaryLength)
    if (binaryBase !== binaryLength) binaryParts.push(new Uint8Array(binaryBase - binaryLength))
    binaryParts.push(parsedRaster.bin.subarray(0, parsedRaster.declaredBinLength))
    binaryLength = checkedSum(binaryBase, parsedRaster.declaredBinLength, `${path}/binary`)
    for (let viewIndex = 0; viewIndex < rasterViews.length; viewIndex += 1) {
      const view = structuredClone(
        requireNonArrayObject(rasterViews[viewIndex], `${path}/bufferViews/${viewIndex}`),
      )
      const byteOffset =
        view.byteOffset === undefined
          ? 0
          : asInteger(view.byteOffset, `${path}/bufferViews/${viewIndex}/byteOffset`)
      view.byteOffset = checkedSum(binaryBase, byteOffset, `${path}/bufferViews/${viewIndex}`)
      views.push(view)
    }
    extensions[raster.extension] = rebaseBufferViewReferences(
      structuredClone(extensionData),
      viewBase,
      rasterViews.length,
      `${path}/extensions/${raster.extension}`,
    )
    if (!used.includes(raster.extension)) used.push(raster.extension)
    directory.push({
      rasterKey: raster.rasterKey,
      kind: raster.kind,
      extension: raster.extension,
      version: raster.version,
      source: { type: 'embedded' },
    })
    outputArtifacts.push(
      ...raster.artifacts.filter(({ role }) => role === 'raster-page').map(asArtifact),
    )
  }

  document.extensionsUsed = used
  document.extensionsRequired = required
  requireNonArrayObject(asArray(document.buffers, '/buffers')[0], '/buffers/0').byteLength = binaryLength
  const combined = encodeGlb(document, concatenate(binaryParts, binaryLength))
  const fontArtifact: BakeArtifactV0 = {
    role: 'font',
    id: coreArtifact.id,
    bytes: combined,
    sha256: await sha256(combined),
  }
  const artifacts = [fontArtifact, ...outputArtifacts]
  assertUniqueArtifactIds(artifacts)
  return {
    artifacts,
    report: mapReport(core, rasters, artifacts),
    warnings: core.warnings,
  }
}

function assertRasterIdentity(
  extension: Readonly<Record<string, unknown>>,
  raster: RasterBakeArtifact,
  shapingHash: string,
  glyphCount: number,
  glyphIdWidth: number,
  path: string,
): void {
  if (
    extension.version !== raster.version ||
    extension.rasterKey !== raster.rasterKey ||
    extension.shapingHash !== shapingHash ||
    extension.glyphCount !== glyphCount ||
    extension.glyphIdWidth !== glyphIdWidth
  ) {
    fail(
      'RASTER_RECIPROCAL_IDENTITY',
      'companion extension does not match its result metadata and core shaping identity',
      path,
    )
  }
}

function rebaseBufferViewReferences(
  value: unknown,
  offset: number,
  count: number,
  path: string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      rebaseBufferViewReferences(entry, offset, count, `${path}/${index}`),
    )
  }
  if (typeof value !== 'object' || value === null) return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}/${key}`
    if (key === 'bufferView' || key.endsWith('BufferView')) {
      const index = asInteger(child, childPath)
      if (index >= count) {
        fail(
          'RASTER_BUFFER_VIEW_RANGE',
          'companion bufferView reference is out of range',
          childPath,
        )
      }
      result[key] = checkedSum(index, offset, childPath)
    } else {
      result[key] = rebaseBufferViewReferences(child, offset, count, childPath)
    }
  }
  return result
}

function mapReport(
  core: FontBakeResultV0,
  rasters: readonly RasterCompositionV0[],
  artifacts: readonly BakeArtifactV0[],
): FontPayloadReport {
  const shaping = core.report.shared.shaping
  return {
    source: core.report.source,
    shared: {
      shaping: {
        ...shaping,
        rawBytes: shaping.totalRawBytes,
      },
    },
    rasters: rasters.map(({ raster }) => ({ kind: raster.kind, ...raster.report })),
    containers:
      rasters.length === 0
        ? core.report.containers
        : artifacts
            .filter(({ role }) => role !== 'raster-page')
            .map((artifact) => containerReport(artifact)),
    transport:
      rasters.length === 0
        ? core.report.transport
        : artifacts.map(({ id, bytes }) => ({
            artifactId: id,
            format: 'raw',
            bytes: bytes.byteLength,
          })),
  }
}

function assertUniqueArtifactIds(artifacts: readonly BakeArtifactV0[]): void {
  const ids = new Set<string>()
  for (let index = 0; index < artifacts.length; index += 1) {
    const id = artifacts[index]!.id
    if (id.length === 0 || ids.has(id)) {
      fail(
        'ARTIFACT_ID',
        'composed artifact IDs must be nonempty and unique',
        `/artifacts/${index}/id`,
      )
    }
    ids.add(id)
  }
}

function containerReport(artifact: BakeArtifactV0): FontPayloadReport['containers'][number] {
  const jsonChunkBytes = readU32(artifact.bytes, 12)
  const json = artifact.bytes.subarray(20, 20 + jsonChunkBytes)
  let jsonBytes = json.byteLength
  while (jsonBytes > 0 && json[jsonBytes - 1] === 0x20) jsonBytes -= 1
  const parsed = parseGlb(artifact.bytes)
  return {
    artifactId: artifact.id,
    role: artifact.role,
    jsonBytes,
    paddingBytes: jsonChunkBytes - jsonBytes + parsed.bin.byteLength - parsed.declaredBinLength,
    totalBytes: artifact.bytes.byteLength,
  }
}

function encodeGlb(document: Readonly<Record<string, unknown>>, binary: Uint8Array): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(document))
  const jsonLength = align4(json.byteLength)
  const binaryLength = align4(binary.byteLength)
  const totalLength = checkedSum(28, checkedSum(jsonLength, binaryLength, '/glb'), '/glb')
  if (totalLength > 0xffff_ffff) fail('GLB_TOO_LARGE', 'composed GLB exceeds uint32 length')
  const bytes = new Uint8Array(totalLength)
  bytes.fill(0x20, 20, 20 + jsonLength)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x4654_6c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, totalLength, true)
  view.setUint32(12, jsonLength, true)
  view.setUint32(16, 0x4e4f_534a, true)
  bytes.set(json, 20)
  const binaryHeader = 20 + jsonLength
  view.setUint32(binaryHeader, binaryLength, true)
  view.setUint32(binaryHeader + 4, 0x004e_4942, true)
  bytes.set(binary, binaryHeader + 8)
  return bytes
}

function concatenate(parts: readonly Uint8Array[], byteLength: number): Uint8Array {
  const output = new Uint8Array(byteLength)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  if (offset !== byteLength) fail('BINARY_LENGTH', 'composed binary parts have inconsistent length')
  return output
}

async function authenticateArtifact(
  artifact: { readonly bytes: Uint8Array; readonly sha256: string },
  path: string,
): Promise<void> {
  if (artifact.sha256 !== (await sha256(artifact.bytes))) {
    fail('ARTIFACT_HASH', 'bake artifact hash does not match its bytes', `${path}/sha256`)
  }
}

function asArtifact(artifact: {
  readonly role: 'font' | 'raster' | 'raster-page'
  readonly id: string
  readonly bytes: Uint8Array
  readonly sha256: string
}): BakeArtifactV0 {
  return { ...artifact, sha256: asHash(artifact.sha256, '/artifact/sha256') }
}

function exactlyOne<Value>(
  values: readonly Value[],
  code: string,
  message: string,
  path?: string,
): Value {
  if (values.length !== 1) fail(code, message, path)
  return values[0]!
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

function stringArray(value: unknown, path: string): string[] {
  return asArray(value, path).map((entry, index) => {
    if (typeof entry !== 'string') fail('TYPE_STRING', 'value must be a string', `${path}/${index}`)
    return entry
  })
}

function asInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail('TYPE_INTEGER', 'value must be a nonnegative safe integer', path)
  }
  return value
}

function asHash(value: unknown, path: string): Sha256Hex {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    fail('TYPE_HASH', 'value must be lowercase hexadecimal SHA-256', path)
  }
  return value as Sha256Hex
}

function align4(value: number): number {
  if (value > Number.MAX_SAFE_INTEGER - 3) fail('ARITHMETIC_OVERFLOW', 'alignment overflowed')
  const remainder = value % 4
  return remainder === 0 ? value : value + 4 - remainder
}

function checkedSum(left: number, right: number, path: string): number {
  const result = left + right
  if (!Number.isSafeInteger(result)) fail('ARITHMETIC_OVERFLOW', 'integer sum overflowed', path)
  return result
}

function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true)
}

async function sha256(bytes: Uint8Array): Promise<Sha256Hex> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer)
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('') as Sha256Hex
}

function fail(code: string, message: string, path?: string): never {
  throw new BakeCompositionError(code, message, path)
}
