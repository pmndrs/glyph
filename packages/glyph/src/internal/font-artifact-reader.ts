import type { PmndrsFontExtension } from '../generated/font-artifact-schema.js';
import { FONT_BAKER_VERSION } from '../font-baker/contract.js';
import { GlyphError } from '../glyph-error.js';
import type { Fingerprint } from '../identity.js';
import type { RegisteredBufferView } from './registered-font.js';
import { readGlb, type ParsedGlb } from './glb-reader.js';

const FONT_EXTENSION = 'PMNDRS_font';

export interface RuntimeFontArtifact {
  readonly parsed: ParsedGlb;
  readonly extension: PmndrsFontExtension;
  readonly bufferViews: readonly RegisteredBufferView[];
  readonly shapingSfnt: Uint8Array;
  readonly glyphExtents: Uint8Array;
  readonly glyphExtentsAvailability: Uint8Array;
  readonly shapingFingerprint: Fingerprint;
  readonly sourceFingerprint: Fingerprint;
}

export class RuntimeFontArtifactError extends GlyphError<'artifact-invalid'> {
  readonly issues: readonly { readonly code: string; readonly message: string }[];

  constructor(code: string, message: string) {
    super('artifact-invalid', `${code}: ${message}`);
    this.name = 'RuntimeFontArtifactError';
    this.issues = [{ code, message }];
  }
}

/**
 * Locate the trusted package extension and its three shaping views.
 *
 * Bake and CI own schema validation. Runtime work is limited to the GLB envelope,
 * extension/version identity, and byte ranges required for safe typed-array views.
 */
export function readRuntimeFontArtifact(bytes: Uint8Array): RuntimeFontArtifact {
  const parsed = readGlb(bytes);
  requireExtensionName(parsed.document.extensionsUsed, 'extensionsUsed');
  requireExtensionName(parsed.document.extensionsRequired, 'extensionsRequired');
  const extensions = record(parsed.document.extensions, 'extensions');
  const extension = record(extensions[FONT_EXTENSION], FONT_EXTENSION) as PmndrsFontExtension;
  if (
    extension.version !== 0 ||
    extension.shaping?.format !== 'opentype-sfnt-harfrust-v0' ||
    extension.metrics?.glyphIdWidth !== 16 ||
    extension.provenance?.bakerVersion !== FONT_BAKER_VERSION ||
    extension.provenance?.harfrustVersion !== '0.12.0' ||
    extension.provenance?.harfbuzzReferenceVersion !== '13.0.0' ||
    extension.provenance?.unicodeVersion !== '17.0.0'
  ) {
    throw new RuntimeFontArtifactError('FONT_VERSION_INCOMPATIBLE', 'PMNDRS_font uses an unsupported runtime format');
  }

  const bufferViews = readBufferViews(parsed);
  const functions = extension.shaping.fontFunctions;
  const shaping = viewAt(parsed, bufferViews, extension.shaping.bufferView, 'shaping.bufferView');
  const extents = viewAt(parsed, bufferViews, functions.glyphExtentsBufferView, 'glyphExtentsBufferView');
  const availability = viewAt(
    parsed,
    bufferViews,
    functions.glyphExtentsAvailabilityBufferView,
    'glyphExtentsAvailabilityBufferView',
  );
  return {
    parsed,
    extension,
    bufferViews,
    shapingSfnt: shaping,
    glyphExtents: extents,
    glyphExtentsAvailability: availability,
    shapingFingerprint: text(extension.shaping.fingerprint, 'shaping.fingerprint') as Fingerprint,
    sourceFingerprint: text(extension.provenance.sourceFingerprint, 'provenance.sourceFingerprint') as Fingerprint,
  };
}

export function readBufferViews(parsed: ParsedGlb): readonly RegisteredBufferView[] {
  const values = parsed.document.bufferViews;
  if (!Array.isArray(values)) throw new TypeError('bufferViews must be an array');
  return values.map((entry, index) => {
    const value = record(entry, `bufferViews[${index}]`);
    if (value.buffer !== 0) throw new TypeError(`bufferViews[${index}] must use buffer 0`);
    const byteOffset =
      value.byteOffset === undefined ? 0 : integer(value.byteOffset, `bufferViews[${index}].byteOffset`);
    const byteLength = integer(value.byteLength, `bufferViews[${index}].byteLength`);
    if (
      byteOffset < 0 ||
      byteLength < 0 ||
      !Number.isSafeInteger(byteOffset + byteLength) ||
      byteOffset + byteLength > parsed.declaredBinLength
    ) {
      throw new RangeError(`bufferViews[${index}] exceeds the declared binary data`);
    }
    return { byteOffset, byteLength };
  });
}

function viewAt(parsed: ParsedGlb, views: readonly RegisteredBufferView[], value: unknown, name: string): Uint8Array {
  const index = integer(value, name);
  const view = views[index];
  if (view === undefined) throw new RangeError(`${name} does not identify a buffer view`);
  return parsed.bin.subarray(view.byteOffset, view.byteOffset + view.byteLength);
}

function requireExtensionName(value: unknown, name: string): void {
  if (!Array.isArray(value) || !value.includes(FONT_EXTENSION)) {
    throw new RuntimeFontArtifactError('FONT_EXTENSION_REQUIRED', `${name} must include ${FONT_EXTENSION}`);
  }
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`${name} must be a safe integer`);
  return value;
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`);
  return value;
}
