import type { CompiledCodecProgramBody, CodecProgramSystemBuffers } from '../config/codec-program.js';
import type { CodecBufferDeclaration, CodecBufferDeclarations, TechniqueSchemaMetadata } from '../config/schema.js';
import type { CodecBufferId } from '../config/codec.js';
import { assertGlyphId } from './glyph-id.js';

interface CompiledCodecMetadata {
  readonly schema: TechniqueSchemaMetadata;
  readonly stableGlyphId: CodecBufferId | undefined;
  readonly transformIndex: CodecBufferId | undefined;
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
  const stableGlyphId = snapshotSystemBuffer(value.stableGlyphId, 'stableGlyphId');
  const transformIndex =
    value.transformIndex === undefined ? undefined : snapshotSystemBuffer(value.transformIndex, 'transformIndex');
  const ids = new Set(Object.values(technique).map((buffer) => buffer.id));
  if (ids.has(stableGlyphId.id)) throw new TypeError('stableGlyphId system buffer collides with a technique buffer');
  if (transformIndex !== undefined) {
    if (transformIndex.id === stableGlyphId.id) {
      throw new TypeError('transformIndex and stableGlyphId system buffers collide');
    }
    if (ids.has(transformIndex.id)) {
      throw new TypeError('transformIndex system buffer collides with a technique buffer');
    }
  }
  return Object.freeze({ stableGlyphId, ...(transformIndex === undefined ? {} : { transformIndex }) });
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
    (compiled.stableGlyphId !== system.stableGlyphId.id || compiled.transformIndex !== system.transformIndex?.id)
  ) {
    throw new TypeError(`technique "${schema.technique}" codec body does not use the requested system buffers`);
  }
}

function snapshotSystemBuffer<const Name extends 'stableGlyphId' | 'transformIndex'>(
  value: unknown,
  name: Name,
): CodecBufferDeclaration<'u32', readonly [Name]> {
  if (!isRecord(value)) throw new TypeError(`${name} system buffer needs one u32 "${name}" lane`);
  const lanes = value.lanes;
  const id = value.id;
  if (
    typeof id !== 'number' ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    id > 0xffff ||
    value.scalar !== 'u32' ||
    !Array.isArray(lanes) ||
    lanes.length !== 1 ||
    lanes[0] !== name
  ) {
    throw new TypeError(`${name} system buffer needs one u32 "${name}" lane`);
  }
  const namedLanes: readonly [Name] = [name];
  return Object.freeze({
    id: assertGlyphId(id, 'buffer', `${name} system buffer id`),
    scalar: 'u32',
    lanes: namedLanes,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
