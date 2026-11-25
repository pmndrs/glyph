import type { CodecBufferId, CodecCapabilitySet, CodecDescriptor, CodecIdFactory } from '../../index.js';
import { id } from '../../config/codec.js';
import { createDecorationCodecProgram, decorationSchema } from '../../config/decoration.js';
import { createRasterCodecProgram } from '../../config/raster.js';
import { defineCodecBuffers } from '../../config/schema.js';
import { bitmapCodec, bitmapSchema } from '../../raster/bitmap.js';
import { msdfCodec, msdfSchema } from '../../raster/msdf.js';
import { slugCodec, slugSchema } from '../../raster/slug.js';

const PIXI3D_STABLE_GLYPH_BUFFER_ID: CodecBufferId = id.buffer('glyph-pixi3d/stable-glyph');
const PIXI3D_PLACEMENT_SLOT_BUFFER_ID: CodecBufferId = id.buffer('glyph-pixi3d/placement-slot');

export const pixi3dSystemBuffers: {
  readonly stableGlyphId: {
    readonly id: typeof PIXI3D_STABLE_GLYPH_BUFFER_ID;
    readonly scalar: 'u32';
    readonly lanes: readonly ['stableGlyphId'];
  };
  readonly placementSlot: {
    readonly id: typeof PIXI3D_PLACEMENT_SLOT_BUFFER_ID;
    readonly scalar: 'u32';
    readonly lanes: readonly ['placementSlot'];
  };
} = defineCodecBuffers({
  stableGlyphId: { id: PIXI3D_STABLE_GLYPH_BUFFER_ID, scalar: 'u32', lanes: ['stableGlyphId'] },
  placementSlot: { id: PIXI3D_PLACEMENT_SLOT_BUFFER_ID, scalar: 'u32', lanes: ['placementSlot'] },
});

/** The lanes behind the `aGlyphFacts` attribute; published only by a config created with `glyphFacts: true`. */
export const pixi3dGlyphFactBuffers: {
  readonly glyphIndex: {
    readonly id: CodecBufferId;
    readonly scalar: 'u32';
    readonly lanes: readonly ['glyphIndex'];
  };
  readonly glyphOrigin: {
    readonly id: CodecBufferId;
    readonly scalar: 'f32';
    readonly lanes: readonly ['inlineOrigin', 'blockOrigin'];
  };
} = defineCodecBuffers({
  glyphIndex: { id: id.buffer('glyph-pixi3d/glyph-index'), scalar: 'u32', lanes: ['glyphIndex'] },
  glyphOrigin: { id: id.buffer('glyph-pixi3d/glyph-origin'), scalar: 'f32', lanes: ['inlineOrigin', 'blockOrigin'] },
});

export function pixi3dCodecDescriptor(ids: CodecIdFactory, glyphFacts = false): CodecDescriptor {
  const pixi3dCodecCapabilitySet: CodecCapabilitySet = Object.freeze({
    capabilities: Object.freeze(['storage-buffers', 'alias-vec2', 'alias-vec4', 'ordered-direct'] as const),
    maxBufferBytes: 16 * 1024 * 1024,
    updateAlignment: 4,
    coalesceGapBytes: 128,
    rangeCallPenaltyBytes: 256,
    maxBuffersPerDraw: glyphFacts ? 11 : 9,
    maxResourcesPerDraw: 1,
    maxIndirectDraws: 0,
    fragmentationBudget: 8,
    wholeBufferThresholdBasisPoints: 7_500,
  });
  const system = glyphFacts ? { ...pixi3dSystemBuffers, ...pixi3dGlyphFactBuffers } : pixi3dSystemBuffers;
  return Object.freeze({
    capabilitySets: [pixi3dCodecCapabilitySet],
    programs: [
      createDecorationCodecProgram({
        techniqueId: ids.technique(decorationSchema.technique),
        programId: ids.program(decorationSchema.technique, 'pixi3d'),
        transformMode: 'direct',
        system: { stableGlyphId: pixi3dSystemBuffers.stableGlyphId },
      }),
      createRasterCodecProgram(bitmapCodec, {
        namespace: 'pixi3d',
        system,
        capabilitySet: pixi3dCodecCapabilitySet,
        transformMode: 'direct',
        ids,
      }),
      createRasterCodecProgram(msdfCodec, {
        namespace: 'pixi3d',
        system,
        capabilitySet: pixi3dCodecCapabilitySet,
        transformMode: 'direct',
        ids,
      }),
      createRasterCodecProgram(slugCodec, {
        namespace: 'pixi3d',
        system,
        capabilitySet: pixi3dCodecCapabilitySet,
        transformMode: 'direct',
        ids,
      }),
    ],
  });
}

export const pixi3dBitmapBuffers: typeof bitmapSchema.buffers = bitmapSchema.buffers;
export const pixi3dMsdfBuffers: typeof msdfSchema.buffers = msdfSchema.buffers;
export const pixi3dSlugBuffers: typeof slugSchema.buffers = slugSchema.buffers;
