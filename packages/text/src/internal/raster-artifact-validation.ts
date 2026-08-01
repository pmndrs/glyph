import type { ParsedGlb } from '@pmndrs/text-font-baker/validate';
import {
  RasterKtxValidationError,
  validateNativeKtx2 as validateNativeKtx2Container,
  type NativeKtx2Format,
} from './raster-ktx.js';
import { DenseGlyphRecordError, validateDenseGlyphRecordTable, type RasterPageDimensions } from './raster-records.js';
import { canonicalJson } from './raster-identity.js';
import { normalizeRasterCoverage, type RasterCoverageV0 } from '../raster-coverage.js';
import type { JsonValue } from '../raster.js';

export interface RasterArtifactValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export class RasterArtifactValidationError extends Error {
  readonly issues: readonly RasterArtifactValidationIssue[];

  constructor(issues: readonly RasterArtifactValidationIssue[]) {
    super(
      issues
        .map((issue) => `${issue.code}${issue.path === undefined ? '' : ` ${issue.path}`}: ${issue.message}`)
        .join('\n'),
    );
    this.name = 'RasterArtifactValidationError';
    this.issues = issues;
  }
}

export interface RasterBufferView {
  readonly byteOffset: number;
  readonly byteLength: number;
  readonly byteStride?: unknown;
  readonly target?: unknown;
}

export interface ResolvedRasterPageSource {
  readonly bytes: Uint8Array;
  readonly source: 'embedded' | 'external';
  readonly uri?: string;
}

export function validateRasterBufferViews(parsed: ParsedGlb, label: string): readonly RasterBufferView[] {
  const values = asArray(parsed.document.bufferViews, '/bufferViews');
  const views = values.map((value, index) => {
    const path = `/bufferViews/${index}`;
    const view = requireNonArrayObject(value, path);
    if (view.buffer !== 0) fail('BUFFER_VIEW_CONTRACT', 'buffer view must reference buffer 0', path);
    const byteOffset = view.byteOffset === undefined ? 0 : asInteger(view.byteOffset, `${path}/byteOffset`, 0);
    const byteLength = asInteger(view.byteLength, `${path}/byteLength`, 1);
    if (byteOffset % 4 !== 0 || byteOffset > parsed.declaredBinLength - byteLength) {
      fail('BUFFER_VIEW_RANGE', `${label} buffer view is misaligned or outside the BIN range`, path);
    }
    return {
      byteOffset,
      byteLength,
      ...(view.byteStride === undefined ? {} : { byteStride: view.byteStride }),
      ...(view.target === undefined ? {} : { target: view.target }),
    };
  });
  const sorted = [...views].sort((left, right) => left.byteOffset - right.byteOffset);
  let end = 0;
  for (const view of sorted) {
    if (view.byteOffset < end) fail('BUFFER_VIEW_OVERLAP', `${label} buffer views overlap`);
    if (!allZero(parsed.bin.subarray(end, view.byteOffset))) {
      fail('BUFFER_VIEW_GAP', `${label} buffer-view alignment gaps must be zero`);
    }
    end = view.byteOffset + view.byteLength;
  }
  if (!allZero(parsed.bin.subarray(end, parsed.declaredBinLength))) {
    fail('BUFFER_TRAILING_DATA', `${label} BIN has unclaimed nonzero trailing data`);
  }
  return views;
}

export function validateDenseRasterRecords(
  records: Uint8Array,
  pages: readonly RasterPageDimensions[],
  glyphCount: number,
  path: string,
  label: string,
  requireNonEmptyPlaneSpans = false,
): void {
  try {
    validateDenseGlyphRecordTable(records, pages, glyphCount, requireNonEmptyPlaneSpans);
  } catch (error) {
    if (error instanceof DenseGlyphRecordError) {
      fail(
        error.code,
        `${label} ${error.message}`,
        error.glyphId === undefined ? path : `${path}/records/${error.glyphId}`,
      );
    }
    throw error;
  }
}

export function validateRasterCoverage(
  parsed: ParsedGlb,
  extension: Readonly<Record<string, unknown>>,
  expectedCoverage: RasterCoverageV0 | undefined,
  views: readonly RasterBufferView[],
  claimedViews: Set<number>,
  glyphCount: number,
  path: string,
  label: string,
): Uint8Array | undefined {
  const hasDescriptor = extension.coverage !== undefined;
  const hasView = extension.coverageBufferView !== undefined;
  if (hasDescriptor !== hasView || hasDescriptor !== (expectedCoverage !== undefined)) {
    fail(
      'RASTER_COVERAGE_CONTRACT',
      `${label} coverage descriptor and coverageBufferView must both be present exactly for a bounded raster`,
      path,
    );
  }
  if (expectedCoverage === undefined) return undefined;

  let actualCoverage: RasterCoverageV0;
  try {
    actualCoverage = normalizeRasterCoverage(extension.coverage)!;
  } catch {
    fail('RASTER_COVERAGE_DESCRIPTOR', `${label} coverage is not canonical`, `${path}/coverage`);
  }
  if (
    canonicalJson(extension.coverage as JsonValue) !== canonicalJson(actualCoverage) ||
    canonicalJson(actualCoverage) !== canonicalJson(expectedCoverage)
  ) {
    fail(
      'RASTER_COVERAGE_DESCRIPTOR',
      `${label} coverage does not match the authenticated raster descriptor`,
      `${path}/coverage`,
    );
  }
  const viewIndex = asInteger(extension.coverageBufferView, `${path}/coverageBufferView`, 0, views.length - 1);
  claimRasterView(claimedViews, views, viewIndex, `${path}/coverageBufferView`, label);
  const expectedBytes = Math.ceil(glyphCount / 8);
  if (views[viewIndex]?.byteLength !== expectedBytes) {
    fail(
      'RASTER_COVERAGE_LENGTH',
      `${label} coverage bitset must contain exactly ceil(glyphCount / 8) bytes`,
      `${path}/coverageBufferView`,
    );
  }
  const coverage = sliceRasterView(parsed, views[viewIndex]!);
  const usedBits = glyphCount % 8;
  if (usedBits !== 0 && (coverage.at(-1)! & ~((1 << usedBits) - 1)) !== 0) {
    fail('RASTER_COVERAGE_PADDING', `${label} coverage padding bits must be zero`, `${path}/coverageBufferView`);
  }
  if (!coverage.some((byte) => byte !== 0)) {
    fail('RASTER_COVERAGE_EMPTY', `${label} coverage must select at least one glyph`, `${path}/coverageBufferView`);
  }
  return coverage;
}

export function validateRasterCoverageRecords(
  coverage: Uint8Array | undefined,
  records: Uint8Array,
  glyphCount: number,
  path: string,
  label: string,
): void {
  if (coverage === undefined) return;
  const view = new DataView(records.buffer, records.byteOffset, records.byteLength);
  for (let glyphId = 0; glyphId < glyphCount; glyphId += 1) {
    if ((coverage[glyphId >> 3]! & (1 << (glyphId & 7))) !== 0) continue;
    if (view.getUint16(glyphId * 20 + 16, true) !== 0xffff) {
      fail(
        'RASTER_COVERAGE_RECORD',
        `${label} unselected glyph ${glyphId} must retain an absent dense record`,
        `${path}/records/${glyphId}`,
      );
    }
  }
}

export async function resolveRasterPageSource(
  source: Record<string, unknown>,
  path: string,
  parsed: ParsedGlb,
  views: readonly RasterBufferView[],
  claimedViews: Set<number>,
  externalPages: ReadonlyMap<string, Uint8Array> | undefined,
  label: string,
): Promise<ResolvedRasterPageSource> {
  if (source.type === 'bufferView') {
    const viewIndex = asInteger(source.bufferView, `${path}/source/bufferView`, 0, views.length - 1);
    claimRasterView(claimedViews, views, viewIndex, `${path}/source/bufferView`, label);
    return { bytes: sliceRasterView(parsed, views[viewIndex]!), source: 'embedded' };
  }
  if (source.type === 'external') {
    const uri = asString(source.uri, `${path}/source/uri`);
    const bytes =
      externalPages?.get(uri) ??
      fail('EXTERNAL_PAGE_MISSING', `external page ${uri} was not supplied for validation`, `${path}/source/uri`);
    if (source.byteLength !== bytes.byteLength) {
      fail('EXTERNAL_PAGE_LENGTH', 'external page byte length does not match its directory', path);
    }
    if (source.artifactHash !== (await sha256(bytes))) {
      fail('EXTERNAL_PAGE_HASH', 'external page hash does not match its directory', path);
    }
    return { bytes, source: 'external', uri };
  }
  fail('PAGE_SOURCE', `${label} page source must be embedded or external`, path);
}

export function validateNativeKtx2(
  bytes: Uint8Array,
  width: number,
  height: number,
  format: NativeKtx2Format,
  path: string,
): void {
  try {
    validateNativeKtx2Container(bytes, width, height, format);
  } catch (error) {
    if (error instanceof RasterKtxValidationError) fail(error.code, error.message, path);
    throw error;
  }
}

export function claimRasterView(
  claimed: Set<number>,
  views: readonly RasterBufferView[],
  index: number,
  path: string,
  label: string,
): void {
  if (claimed.has(index)) fail('BUFFER_VIEW_ALIAS', `${label} resources must use distinct views`, path);
  const view = views[index];
  if (view?.byteStride !== undefined || view?.target !== undefined) {
    fail('BUFFER_VIEW_CONTRACT', `${label} buffer views must omit byteStride and target`, path);
  }
  claimed.add(index);
}

export function claimCoreRasterViews(
  value: unknown,
  claimed: Set<number>,
  viewCount: number,
  extensionName: string,
  label: string,
): void {
  const font = requireNonArrayObject(value, '/extensions/PMNDRS_font');
  const shaping = requireNonArrayObject(font.shaping, '/extensions/PMNDRS_font/shaping');
  const functions = requireNonArrayObject(shaping.fontFunctions, '/extensions/PMNDRS_font/shaping/fontFunctions');
  for (const [candidate, path] of [
    [shaping.bufferView, '/extensions/PMNDRS_font/shaping/bufferView'],
    [functions.glyphExtentsBufferView, '/extensions/PMNDRS_font/shaping/fontFunctions/glyphExtentsBufferView'],
    [
      functions.glyphExtentsAvailabilityBufferView,
      '/extensions/PMNDRS_font/shaping/fontFunctions/glyphExtentsAvailabilityBufferView',
    ],
  ] as const) {
    const index = asInteger(candidate, path, 0, viewCount - 1);
    if (claimed.has(index)) {
      fail('CORE_BUFFER_VIEW_ALIAS', 'core font buffer views must be distinct', path);
    }
    claimed.add(index);
  }
  const rasters = asArray(font.rasters, '/extensions/PMNDRS_font/rasters');
  const matches = rasters.filter((entry) => {
    const raster = requireNonArrayObject(entry, '/extensions/PMNDRS_font/rasters');
    const source = requireNonArrayObject(raster.source, '/extensions/PMNDRS_font/rasters/source');
    return raster.extension === extensionName && source.type === 'embedded';
  });
  if (matches.length !== 1) {
    fail(
      `${label.toUpperCase()}_DIRECTORY`,
      `combined font GLB must contain exactly one embedded ${label} directory entry`,
      '/extensions/PMNDRS_font/rasters',
    );
  }
}

export function claimOtherRasterExtensionViews(
  extensions: Readonly<Record<string, unknown>>,
  claimed: Set<number>,
  viewCount: number,
  activeExtensionName: string,
): void {
  for (const [name, extension] of Object.entries(extensions)) {
    if (name === 'PMNDRS_font' || name === activeExtensionName) continue;
    visit(extension, `/extensions/${name}`);
  }

  function visit(value: unknown, path: string): void {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}/${index}`));
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}/${key}`;
      if (key === 'bufferView' || key.endsWith('BufferView')) {
        const index = asInteger(child, childPath, 0, viewCount - 1);
        if (claimed.has(index)) {
          fail('BUFFER_VIEW_ALIAS', 'companion extensions must own distinct buffer views', childPath);
        }
        claimed.add(index);
      } else {
        visit(child, childPath);
      }
    }
  }
}

export function withSchemaId(schema: Readonly<Record<string, unknown>>, id: string): Readonly<Record<string, unknown>> {
  return { ...schema, $id: id };
}

export function sliceRasterView(parsed: ParsedGlb, view: RasterBufferView): Uint8Array {
  return parsed.bin.subarray(view.byteOffset, view.byteOffset + view.byteLength);
}

export function requireNonArrayObject(value: unknown, path: string): Record<string, unknown> {
  assertNonArrayObject(value, path);
  return value;
}

function assertNonArrayObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('TYPE_OBJECT', 'value must be an object', path);
  }
}

export function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail('TYPE_ARRAY', 'value must be an array', path);
  return value;
}

export function asString(value: unknown, path: string): string {
  if (typeof value !== 'string') fail('TYPE_STRING', 'value must be a string', path);
  return value;
}

export function stringArray(value: unknown, path: string): string[] {
  return asArray(value, path).map((entry, index) => asString(entry, `${path}/${index}`));
}

export function asInteger(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number = Number.MAX_SAFE_INTEGER,
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail('TYPE_INTEGER', `value must be an integer in ${minimum}..=${maximum}`, path);
  }
  return value;
}

export function checkedProduct(left: number, right: number, path: string): number {
  const value = left * right;
  if (!Number.isSafeInteger(value)) fail('ARITHMETIC_OVERFLOW', 'integer product overflowed', path);
  return value;
}

export function checkedSum(left: number, right: number, path: string): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) fail('ARITHMETIC_OVERFLOW', 'integer sum overflowed', path);
  return value;
}

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export function fail(code: string, message: string, path?: string): never {
  throw new RasterArtifactValidationError([{ code, message, ...(path === undefined ? {} : { path }) }]);
}

function allZero(bytes: Uint8Array): boolean {
  return bytes.every((value) => value === 0);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
