import type { CompiledCodecProgramBody, CodecProgramSystemBuffers } from '../config/codec-program.js';
import type { CodecBufferDeclaration, CodecBufferDeclarations, TechniqueSchemaMetadata } from '../config/schema.js';
import type { CodecBufferId } from '../config/codec.js';
import { assertGlyphId } from './glyph-id.js';

interface CompiledCodecMetadata {
  readonly schema: TechniqueSchemaMetadata;
  readonly occurrence: CodecBufferId | undefined;
}

const metadata = new WeakMap<object, CompiledCodecMetadata>();

export function recordTechniqueCodecBody(body: object, value: CompiledCodecMetadata): void {
  metadata.set(body, value);
}

export function normalizeCodecProgramSystemBuffers(
  technique: CodecBufferDeclarations,
  value: unknown,
): CodecProgramSystemBuffers {
  if (!isRecord(value)) throw new TypeError('codec system buffers need an object');
  const occurrence = snapshotOccurrenceBuffer(value.occurrence);
  const ids = new Set(Object.values(technique).map((buffer) => buffer.id));
  if (ids.has(occurrence.id)) throw new TypeError('occurrence system buffer collides with a technique buffer');
  return Object.freeze({ occurrence });
}

export function assertTechniqueCodecBody<Schema extends TechniqueSchemaMetadata>(
  body: unknown,
  schema: Schema,
  system?: CodecProgramSystemBuffers,
): asserts body is CompiledCodecProgramBody<Schema> {
  const compiled = typeof body === 'object' && body !== null ? metadata.get(body) : undefined;
  if (compiled?.schema !== schema) {
    throw new TypeError(`technique "${schema.technique}" codec body does not belong to its registered schema`);
  }
  if (
    system !== undefined &&
    compiled.occurrence !== system.occurrence.id
  ) {
    throw new TypeError(`technique "${schema.technique}" codec body does not use the requested system buffers`);
  }
}

function snapshotOccurrenceBuffer(
  value: unknown,
): CodecBufferDeclaration<'u32', readonly ['stableGlyphId', 'placementSlot', 'transformIndex', 'foregroundRgba']> {
  if (!isRecord(value)) {
    throw new TypeError(
      'occurrence system buffer needs u32 stableGlyphId, placementSlot, transformIndex, and foregroundRgba lanes',
    );
  }
  const lanes = value.lanes;
  const id = value.id;
  if (
    typeof id !== 'number' ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    id > 0xffff ||
    value.scalar !== 'u32' ||
    !Array.isArray(lanes) ||
    lanes.length !== 4 ||
    lanes[0] !== 'stableGlyphId' ||
    lanes[1] !== 'placementSlot' ||
    lanes[2] !== 'transformIndex' ||
    lanes[3] !== 'foregroundRgba'
  ) {
    throw new TypeError(
      'occurrence system buffer needs u32 stableGlyphId, placementSlot, transformIndex, and foregroundRgba lanes',
    );
  }
  return Object.freeze({
    id: assertGlyphId(id, 'buffer', 'occurrence system buffer id'),
    scalar: 'u32',
    lanes: ['stableGlyphId', 'placementSlot', 'transformIndex', 'foregroundRgba'] as const,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
