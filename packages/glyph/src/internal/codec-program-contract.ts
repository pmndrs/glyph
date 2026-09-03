import type { CompiledCodecProgramBody, CodecProgramSystemBuffers } from '../config/codec-program.js';
import type { AnyTechniqueSchema, CodecBufferDeclaration, CodecBufferDeclarations } from '../config/schema.js';
import type { CodecBufferId } from '../config/codec.js';

interface CompiledCodecMetadata {
  readonly schema: AnyTechniqueSchema;
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

export function assertTechniqueCodecBody(
  body: unknown,
  schema: AnyTechniqueSchema,
  system?: CodecProgramSystemBuffers,
): asserts body is CompiledCodecProgramBody<AnyTechniqueSchema> {
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
  if (
    !Number.isSafeInteger(value.id) ||
    (value.id as number) <= 0 ||
    (value.id as number) > 0xffff ||
    value.scalar !== 'u32' ||
    !Array.isArray(lanes) ||
    lanes.length !== 1 ||
    lanes[0] !== name
  ) {
    throw new TypeError(`${name} system buffer needs one u32 "${name}" lane`);
  }
  return Object.freeze({ id: value.id, scalar: 'u32', lanes: Object.freeze([name]) }) as CodecBufferDeclaration<
    'u32',
    readonly [Name]
  >;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
