import {
  compileCodec,
  createCodecProgram,
  id,
  type CodecAllocationMode,
  type CodecBuffer,
  type CodecBufferId,
  type CodecCapabilitySet,
  type CodecDescriptor,
  type CodecProgram,
  type CodecTransformMode,
  type CodecIdFactory,
  type CodecProgramId,
  type CodecTechniqueId,
} from '../config/codec.js';
import { techniqueProgram } from '../config/codec-program.js';
import { createRasterCodecProgram } from '../config/raster.js';
import {
  defineCodecBuffers,
  defineTechniqueSchema,
  schemaCodecBuffers,
  type TechniqueSchema,
  type TechniqueSchemaMetadata,
} from '../config/schema.js';
import { bitmapCodec } from '../raster/bitmap.js';
import { msdfCodec } from '../raster/msdf.js';
import { slugCodec } from '../raster/slug.js';

const THREE_STABLE_GLYPH_BUFFER_ID: CodecBufferId = id.buffer('glyph-three/stable-glyph');
const THREE_TRANSFORM_INDEX_BUFFER_ID: CodecBufferId = id.buffer('glyph-three/transform-index');
const DECORATION_RECT_BUFFER_ID: CodecBufferId = id.buffer('glyph-three/decoration/rect');
const DECORATION_PACKED_BUFFER_ID: CodecBufferId = id.buffer('glyph-three/decoration/packed');

/** Buffers the Three Codec itself owns, shared by every program in it. */
export const threeSystemBuffers: {
  readonly stableGlyphId: {
    readonly id: typeof THREE_STABLE_GLYPH_BUFFER_ID;
    readonly scalar: 'u32';
    readonly lanes: readonly ['stableGlyphId'];
  };
  readonly transformIndex: {
    readonly id: typeof THREE_TRANSFORM_INDEX_BUFFER_ID;
    readonly scalar: 'u32';
    readonly lanes: readonly ['transformIndex'];
  };
} = defineCodecBuffers({
  stableGlyphId: { id: THREE_STABLE_GLYPH_BUFFER_ID, scalar: 'u32', lanes: ['stableGlyphId'] },
  transformIndex: { id: THREE_TRANSFORM_INDEX_BUFFER_ID, scalar: 'u32', lanes: ['transformIndex'] },
});

export const TRANSFORM_BUFFER_ID: CodecBufferId = threeSystemBuffers.transformIndex.id;

export const STABLE_GLYPH_BUFFER_ID: CodecBufferId = threeSystemBuffers.stableGlyphId.id;

/**
 * Decoration is a reserved technique of the Three Codec rather than a raster
 * technique: rows are resource-free and fill the gather lanes directly.
 */
export const decorationSchema: TechniqueSchema<
  {
    readonly rect: {
      readonly id: typeof DECORATION_RECT_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['left', 'top', 'width', 'height'];
    };
    readonly packed: {
      readonly id: typeof DECORATION_PACKED_BUFFER_ID;
      readonly scalar: 'u32';
      readonly lanes: readonly ['color', 'flags'];
    };
  },
  { readonly u32: readonly ['color', 'flags'] }
> = defineTechniqueSchema({
  technique: 'pmndrs.decoration',
  scope: 'glyph',
  binding: { u32: ['color', 'flags'] },
  buffers: {
    rect: { id: DECORATION_RECT_BUFFER_ID, scalar: 'f32', lanes: ['left', 'top', 'width', 'height'] },
    packed: { id: DECORATION_PACKED_BUFFER_ID, scalar: 'u32', lanes: ['color', 'flags'] },
  },
});

export type ThreeTransformMode = CodecTransformMode;

export type ThreeAllocationMode = CodecAllocationMode;

export interface ThreeFormatTransformModes {
  readonly bitmap: ThreeTransformMode;
  readonly msdf: ThreeTransformMode;
  readonly slug: ThreeTransformMode;
}

const THREE_PROGRAM_NAMESPACE = 'three';

/** Compiler-mapped Three Codec covering every first-party raster format in one registration. */
export function threeCodecBytes(
  ids: CodecIdFactory = id,
  transformMode: ThreeTransformMode | ThreeFormatTransformModes = 'indexed',
  additionalPrograms: readonly CodecProgram[] = [],
  allocationMode: ThreeAllocationMode = 'ordered',
): Uint8Array {
  return compileCodec(threeCodecDescriptor(ids, transformMode, additionalPrograms, allocationMode));
}

/** @internal Assemble the descriptor retained by the Three adapter alongside its compiled wire Codec. */
export function threeCodecDescriptor(
  ids: CodecIdFactory = id,
  transformMode: ThreeTransformMode | ThreeFormatTransformModes = 'indexed',
  additionalPrograms: readonly CodecProgram[] = [],
  allocationMode: ThreeAllocationMode = 'ordered',
): CodecDescriptor {
  if (!Array.isArray(additionalPrograms)) throw new TypeError('Three additional Codec programs need an array');
  if (allocationMode !== 'ordered' && allocationMode !== 'stable') {
    throw new TypeError('Three allocation mode must be "ordered" or "stable"');
  }
  const modes =
    typeof transformMode === 'string'
      ? { bitmap: transformMode, msdf: transformMode, slug: transformMode }
      : { bitmap: transformMode?.bitmap, msdf: transformMode?.msdf, slug: transformMode?.slug };
  for (const [name, mode] of Object.entries(modes)) {
    if (mode !== 'direct' && mode !== 'indexed') {
      throw new TypeError(`Three ${name} transform mode must be "direct" or "indexed"`);
    }
  }
  const capabilitySet = threeCodecCapabilitySet();
  // The portable assembler validates the handle-supplied factory before Three invokes it directly.
  const rasterPrograms: CodecProgram[] = [
    createRasterCodecProgram(bitmapCodec, {
      namespace: THREE_PROGRAM_NAMESPACE,
      system: codecSystemBuffers(modes.bitmap),
      capabilitySet,
      transformMode: modes.bitmap,
      allocationMode,
      ids,
    }),
    createRasterCodecProgram(msdfCodec, {
      namespace: THREE_PROGRAM_NAMESPACE,
      system: codecSystemBuffers(modes.msdf),
      capabilitySet,
      transformMode: modes.msdf,
      allocationMode,
      ids,
    }),
    createRasterCodecProgram(slugCodec, {
      namespace: THREE_PROGRAM_NAMESPACE,
      system: codecSystemBuffers(modes.slug),
      capabilitySet,
      transformMode: modes.slug,
      allocationMode,
      ids,
    }),
  ];
  const DECORATION_TECHNIQUE_ID = ids.technique(decorationSchema.technique);
  const DECORATION_PROGRAM_ID = ids.program(decorationSchema.technique, THREE_PROGRAM_NAMESPACE);
  const programs: CodecProgram[] = [
    ...rasterPrograms,
    decorationProgram(DECORATION_TECHNIQUE_ID, DECORATION_PROGRAM_ID, modes.bitmap, allocationMode),
    ...additionalPrograms,
  ];
  return { capabilitySets: [capabilitySet], programs };
}

export function threeCodecCapabilitySet(): CodecCapabilitySet {
  return {
    capabilities: ['storage-buffers', 'alias-vec2', 'alias-vec4', 'ordered-direct', 'stable-indirect'],
    maxBufferBytes: 64 * 1024 * 1024,
    updateAlignment: 4,
    coalesceGapBytes: 128,
    rangeCallPenaltyBytes: 256,
    maxBuffersPerDraw: 16,
    maxResourcesPerDraw: 16,
    maxIndirectDraws: 0,
    fragmentationBudget: 8,
    wholeBufferThresholdBasisPoints: 7_500,
  };
}

/**
 * Resource-free decoration quads. Decoration rows fill the gather lanes directly —
 * f32 lanes 0-3 carry the rectangle and u32 lanes carry transform, stable identity,
 * color, then flags — so the semantic handles below address gather lanes by
 * position, not per-glyph meaning: the "inlineOrigin" lane is the rect's inline
 * start, and the paint arrives through the binding's packed u32 pair.
 */
function decorationProgram(
  techniqueId: CodecTechniqueId,
  programId: CodecProgramId,
  transformMode: ThreeTransformMode,
  allocationMode: ThreeAllocationMode,
): CodecProgram {
  const p = techniqueProgram(decorationSchema, { system: codecSystemBuffers(transformMode) });
  const { inlineOrigin, blockOrigin, fontSize, color } = p.semantics;
  return {
    ...createCodecProgram(
      techniqueId,
      programId,
      p.compile({
        rect: [inlineOrigin, blockOrigin, fontSize, color.red],
        packed: [p.binding.color, p.binding.flags],
      }),
      programBuffers(decorationSchema, transformMode),
      transformMode,
      allocationMode,
    ),
    primitiveKind: 'decoration',
    resourceKindMask: 0,
  };
}

function codecSystemBuffers(transformMode: ThreeTransformMode) {
  return transformMode === 'indexed' ? threeSystemBuffers : { stableGlyphId: threeSystemBuffers.stableGlyphId };
}

/** Every Three program publishes its schema's buffers, then the Codec's own system buffers. */
function programBuffers(schema: TechniqueSchemaMetadata, transformMode: ThreeTransformMode): CodecBuffer[] {
  return [
    ...schemaCodecBuffers(schema),
    stableGlyphIdBuffer(),
    ...(transformMode === 'indexed' ? [transformIndexBuffer()] : []),
  ];
}

function transformIndexBuffer(): CodecBuffer {
  return {
    id: TRANSFORM_BUFFER_ID,
    scalar: 'u32',
    vectorWidth: 1,
  };
}

function stableGlyphIdBuffer(): CodecBuffer {
  return {
    id: STABLE_GLYPH_BUFFER_ID,
    scalar: 'u32',
    vectorWidth: 1,
  };
}
