import {
  compileCodec,
  id,
  type CodecBufferId,
  type CodecCapabilitySet,
  type CodecDescriptor,
  type CodecProgram,
  type CodecTransformMode,
  type CodecIdFactory,
  type CodecProgramId,
  type CodecTechniqueId,
} from '../config/codec.js';
import type { CodecProgramSystemBuffers } from '../config/codec-program.js';
import type { RasterCodecSystem } from '../config/raster.js';
import { createDecorationCodecProgram, decorationSchema } from '../config/decoration.js';
import { createHostRasterCodecProgram } from '../config/raster-host.js';
import { defineCodecBuffers } from '../config/schema.js';
import { bitmapCodec } from '../raster/bitmap.js';
import { msdfCodec } from '../raster/msdf.js';
import { slugCodec, slugSchema } from '../raster/slug.js';

export { decorationSchema } from '../config/decoration.js';

const THREE_STABLE_GLYPH_BUFFER_ID: CodecBufferId = id.buffer('glyph-three/stable-glyph');
const THREE_TRANSFORM_INDEX_BUFFER_ID: CodecBufferId = id.buffer('glyph-three/transform-index');
const THREE_PLACEMENT_SLOT_BUFFER_ID: CodecBufferId = id.buffer('glyph-three/placement-slot');
const THREE_GLYPH_INDEX_BUFFER_ID: CodecBufferId = id.buffer('glyph-three/glyph-index');
const THREE_GLYPH_ORIGIN_BUFFER_ID: CodecBufferId = id.buffer('glyph-three/glyph-origin');

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
  readonly placementSlot: {
    readonly id: typeof THREE_PLACEMENT_SLOT_BUFFER_ID;
    readonly scalar: 'u32';
    readonly lanes: readonly ['placementSlot'];
  };
  readonly glyphIndex: {
    readonly id: typeof THREE_GLYPH_INDEX_BUFFER_ID;
    readonly scalar: 'u32';
    readonly lanes: readonly ['glyphIndex'];
  };
  readonly glyphOrigin: {
    readonly id: typeof THREE_GLYPH_ORIGIN_BUFFER_ID;
    readonly scalar: 'f32';
    readonly lanes: readonly ['inlineOrigin', 'blockOrigin'];
  };
} = defineCodecBuffers({
  stableGlyphId: { id: THREE_STABLE_GLYPH_BUFFER_ID, scalar: 'u32', lanes: ['stableGlyphId'] },
  transformIndex: { id: THREE_TRANSFORM_INDEX_BUFFER_ID, scalar: 'u32', lanes: ['transformIndex'] },
  placementSlot: { id: THREE_PLACEMENT_SLOT_BUFFER_ID, scalar: 'u32', lanes: ['placementSlot'] },
  glyphIndex: { id: THREE_GLYPH_INDEX_BUFFER_ID, scalar: 'u32', lanes: ['glyphIndex'] },
  glyphOrigin: { id: THREE_GLYPH_ORIGIN_BUFFER_ID, scalar: 'f32', lanes: ['inlineOrigin', 'blockOrigin'] },
});

export const TRANSFORM_BUFFER_ID: CodecBufferId = threeSystemBuffers.transformIndex.id;

export const STABLE_GLYPH_BUFFER_ID: CodecBufferId = threeSystemBuffers.stableGlyphId.id;
export const PLACEMENT_SLOT_BUFFER_ID: CodecBufferId = threeSystemBuffers.placementSlot.id;

export type ThreeTransformMode = CodecTransformMode;

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
): Uint8Array {
  return compileCodec(threeCodecDescriptor(ids, transformMode, additionalPrograms));
}

/** @internal Assemble the descriptor retained by the Three adapter alongside its compiled wire Codec. */
export function threeCodecDescriptor(
  ids: CodecIdFactory = id,
  transformMode: ThreeTransformMode | ThreeFormatTransformModes = 'indexed',
  additionalPrograms: readonly CodecProgram[] = [],
): CodecDescriptor {
  if (!Array.isArray(additionalPrograms)) throw new TypeError('Three additional Codec programs need an array');
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
  const slugOptions = {
    namespace: THREE_PROGRAM_NAMESPACE,
    system: codecSystemBuffers(modes.slug),
    placementSlotTarget: { buffer: slugSchema.buffers.glyph.id, lane: 1 },
    capabilitySet,
    transformMode: modes.slug,
    ids,
  } as const;
  // The portable assembler validates the handle-supplied factory before Three invokes it directly.
  const rasterPrograms: CodecProgram[] = [
    createHostRasterCodecProgram(bitmapCodec, {
      namespace: THREE_PROGRAM_NAMESPACE,
      system: codecSystemBuffers(modes.bitmap),
      capabilitySet,
      transformMode: modes.bitmap,
      ids,
    }),
    createHostRasterCodecProgram(msdfCodec, {
      namespace: THREE_PROGRAM_NAMESPACE,
      system: codecSystemBuffers(modes.msdf),
      capabilitySet,
      transformMode: modes.msdf,
      ids,
    }),
    createHostRasterCodecProgram(slugCodec, slugOptions),
  ];
  const DECORATION_TECHNIQUE_ID = ids.technique(decorationSchema.technique);
  const DECORATION_PROGRAM_ID = ids.program(decorationSchema.technique, THREE_PROGRAM_NAMESPACE);
  const programs: CodecProgram[] = [
    ...rasterPrograms,
    decorationProgram(DECORATION_TECHNIQUE_ID, DECORATION_PROGRAM_ID, modes.bitmap),
    ...additionalPrograms,
  ];
  return { capabilitySets: [capabilitySet], programs };
}

export function threeCodecCapabilitySet(): CodecCapabilitySet {
  return {
    capabilities: ['storage-buffers', 'alias-vec2', 'alias-vec4', 'ordered-direct'],
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

function decorationProgram(
  techniqueId: CodecTechniqueId,
  programId: CodecProgramId,
  transformMode: ThreeTransformMode,
): CodecProgram {
  return createDecorationCodecProgram({
    techniqueId,
    programId,
    transformMode,
    system: decorationSystemBuffers(transformMode),
  });
}

function codecSystemBuffers(transformMode: ThreeTransformMode): RasterCodecSystem {
  return {
    stableGlyphId: threeSystemBuffers.stableGlyphId,
    ...(transformMode === 'indexed' ? { transformIndex: threeSystemBuffers.transformIndex } : {}),
    placementSlot: threeSystemBuffers.placementSlot,
    glyphIndex: threeSystemBuffers.glyphIndex,
    glyphOrigin: threeSystemBuffers.glyphOrigin,
  };
}

function decorationSystemBuffers(transformMode: ThreeTransformMode): CodecProgramSystemBuffers {
  return {
    stableGlyphId: threeSystemBuffers.stableGlyphId,
    ...(transformMode === 'indexed' ? { transformIndex: threeSystemBuffers.transformIndex } : {}),
  };
}
