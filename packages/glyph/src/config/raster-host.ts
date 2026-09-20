import { createCodecProgram, normalizeCodecCapabilitySet, type CodecBuffer, type CodecProgram } from './codec.js';
import type { RasterFormatMetadata } from './raster-format.js';
import type { RasterCodec, RasterCodecProgramOptions, RasterCodecSystem } from './raster.js';
import { schemaCodecBuffers, type TechniqueSchemaMetadata } from './schema.js';
import {
  assertTechniqueCodecBody,
  attachHostCodecProgramSystemBuffers,
  type CodecProgramU32StoreTarget,
  normalizeCodecProgramSystemBuffers,
} from '../internal/codec-program-contract.js';
import { isRegisteredRasterCodec } from '../internal/raster-codec-registry.js';
import { assertCodecIdFactory, CodecIdScope } from '../internal/render-id.js';

export { attachHostCodecProgramSystemBuffers } from '../internal/codec-program-contract.js';
export { hostAbsoluteTechniqueProgram } from '../internal/codec-program.js';

export interface RasterCodecHostOptions extends RasterCodecProgramOptions {
  readonly placementSlotTarget?: CodecProgramU32StoreTarget;
}

export function createHostRasterCodecProgram<
  Format extends RasterFormatMetadata,
  Schema extends TechniqueSchemaMetadata,
>(codec: RasterCodec<Format, Schema>, options: RasterCodecHostOptions): CodecProgram {
  if (!isRegisteredRasterCodec(codec)) {
    throw new TypeError('raster codec assembly needs a registered RasterCodec');
  }
  if (!isRecord(options)) throw new TypeError('raster codec assembly options need an object');
  if ('identityRegistry' in options) {
    throw new TypeError('raster codec identityRegistry was renamed to ids');
  }
  if (typeof options.namespace !== 'string' || options.namespace.length === 0) {
    throw new TypeError('raster codec namespace must be a nonempty string');
  }
  if (
    options.programName !== undefined &&
    (typeof options.programName !== 'string' || options.programName.length === 0)
  ) {
    throw new TypeError('raster codec programName must be a nonempty string');
  }
  if (options.transformMode !== 'direct' && options.transformMode !== 'indexed') {
    throw new TypeError('raster codec transform mode must be "direct" or "indexed"');
  }
  if (options.ids !== undefined) {
    assertCodecIdFactory(options.ids, 'raster codec ids');
  }
  const normalizedSystem = normalizeCodecProgramSystemBuffers(codec.schema.buffers, options.system);
  const placementSlot = normalizedSystem.placementSlot;
  if (placementSlot === undefined) {
    throw new TypeError('raster codec system needs a host-owned placementSlot buffer');
  }
  const system: RasterCodecSystem = Object.freeze({ ...normalizedSystem, placementSlot });
  const placementSlotTarget = normalizePlacementSlotTarget(codec.schema, options.placementSlotTarget);
  const capabilitySet = normalizeCodecCapabilitySet(options.capabilitySet, 'raster codec capability set');
  const ids = options.ids ?? new CodecIdScope();
  const compiledTechniqueId = ids.technique(codec.raster);
  const compiledProgramId = ids.program(codec.raster, options.namespace, options.programName);
  const authoredBody = codec.codecBody(capabilitySet);
  assertTechniqueCodecBody(authoredBody, codec.schema);
  const body = attachHostCodecProgramSystemBuffers(authoredBody, codec.schema, system, placementSlotTarget);
  assertTechniqueCodecBody(body, codec.schema, system, placementSlotTarget);
  const techniqueBuffers = schemaCodecBuffers(codec.schema);
  const systemBuffers = systemCodecBuffers(system, placementSlotTarget);
  if (techniqueBuffers.length + systemBuffers.length > capabilitySet.maxBuffersPerDraw) {
    const systemNames = [
      'stableGlyphId',
      ...(placementSlotTarget === undefined ? ['placementSlot'] : []),
      ...(system.transformIndex === undefined ? [] : ['transformIndex']),
    ];
    throw new TypeError(
      `raster codec "${codec.schema.technique}" needs ${techniqueBuffers.length + systemBuffers.length} buffers per draw ` +
        `(${techniqueBuffers.length} technique buffers plus ${systemNames.join(', ')}) ` +
        `but the capability set binds at most ${capabilitySet.maxBuffersPerDraw}`,
    );
  }
  return Object.freeze({
    ...createCodecProgram(
      compiledTechniqueId,
      compiledProgramId,
      body,
      [...techniqueBuffers, ...systemBuffers],
      options.transformMode,
    ),
    capabilitySet,
    variant: codec.programVariant ?? 0,
  });
}

function systemCodecBuffers(
  system: RasterCodecSystem,
  placementSlotTarget: CodecProgramU32StoreTarget | undefined,
): CodecBuffer[] {
  return [
    { id: system.stableGlyphId.id, scalar: 'u32', vectorWidth: 1 },
    ...(placementSlotTarget === undefined
      ? [{ id: system.placementSlot.id, scalar: 'u32' as const, vectorWidth: 1 }]
      : []),
    ...(system.transformIndex === undefined
      ? []
      : [{ id: system.transformIndex.id, scalar: 'u32' as const, vectorWidth: 1 }]),
  ];
}

function normalizePlacementSlotTarget(
  schema: TechniqueSchemaMetadata,
  value: CodecProgramU32StoreTarget | undefined,
): CodecProgramU32StoreTarget | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !Number.isSafeInteger(value.buffer) || !Number.isSafeInteger(value.lane)) {
    throw new TypeError('placementSlotTarget needs an existing u32 technique buffer and lane');
  }
  const declaration = Object.values(schema.buffers).find((buffer) => buffer.id === value.buffer);
  if (
    declaration?.scalar !== 'u32' ||
    value.lane < 0 ||
    value.lane >= declaration.lanes.length ||
    !declaration.lanes[value.lane]?.startsWith('unused')
  ) {
    throw new TypeError('placementSlotTarget needs an unused lane in an existing u32 technique buffer');
  }
  return Object.freeze({ buffer: declaration.id, lane: value.lane });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
