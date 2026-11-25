import type { CodecBufferId, CodecCapabilitySet, CodecDescriptor, CodecIdFactory } from '../../index.js';
import { id } from '../../config/codec.js';
import { defineCodecBuffers } from '../../config/schema.js';
import { createHostRasterCodecProgram } from '../../config/raster-host.js';
import { bitmapCodec } from '../../raster/bitmap.js';
import { msdfCodec } from '../../raster/msdf.js';
import { slugCodec } from '../../raster/slug.js';

const system = defineCodecBuffers({
  stableGlyphId: { id: id.buffer('glyph-typegpu/stable-glyph'), scalar: 'u32', lanes: ['stableGlyphId'] },
  placementSlot: { id: id.buffer('glyph-typegpu/placement-slot'), scalar: 'u32', lanes: ['placementSlot'] },
  transformIndex: { id: id.buffer('glyph-typegpu/transform-index'), scalar: 'u32', lanes: ['transformIndex'] },
});
/** The lane behind the glyph parameters of `transformPosition` and `transformColor`; published only when one asks. */
const glyphFacts = defineCodecBuffers({
  glyphFacts: {
    id: id.buffer('glyph-typegpu/glyph-facts'),
    scalar: 'f32',
    lanes: ['inlineOrigin', 'blockOrigin', 'glyphIndex', 'unused'],
  },
});
export const TYPEGPU_GLYPH_FACTS_BUFFER_ID: CodecBufferId = glyphFacts.glyphFacts.id;
export const TYPEGPU_PLACEMENT_SLOT_BUFFER_ID: CodecBufferId = system.placementSlot.id;
/** Per-instance record in the renderer's transform table; every first-party program is indexed. */
export const TYPEGPU_TRANSFORM_INDEX_BUFFER_ID: CodecBufferId = system.transformIndex.id;
const capabilities = {
  capabilities: ['storage-buffers', 'alias-vec2', 'alias-vec4', 'ordered-direct'],
  maxBufferBytes: 16 * 1024 * 1024,
  updateAlignment: 4,
  coalesceGapBytes: 128,
  rangeCallPenaltyBytes: 256,
  maxResourcesPerDraw: 4,
  maxIndirectDraws: 0,
  fragmentationBudget: 8,
  wholeBufferThresholdBasisPoints: 7500,
} as const;
/**
 * `glyphFactLanes` adds the glyph facts lane a config publishes when one of its callbacks declares the
 * glyph parameters. A config that asks for neither publishes, uploads and binds exactly what it did without them.
 */
export function codecDescriptor(ids: CodecIdFactory, glyphFactLanes = false): CodecDescriptor {
  const capabilitySet: CodecCapabilitySet = {
    ...capabilities,
    // Bitmap's six vertex lanes plus the placement-slot and transform-index storage lanes, and the glyph facts
    // lane when published; stableGlyphId is published but never bound.
    maxBuffersPerDraw: glyphFactLanes ? 10 : 9,
  };
  // Batched programs read each Text's offset from the transform table, so many Texts share one draw.
  const options = {
    ids,
    namespace: 'typegpu',
    system: glyphFactLanes ? { ...system, ...glyphFacts } : system,
    capabilitySet,
    transformMode: 'indexed',
  } as const;
  return {
    capabilitySets: [capabilitySet],
    programs: [
      createHostRasterCodecProgram(bitmapCodec, options),
      createHostRasterCodecProgram(msdfCodec, options),
      createHostRasterCodecProgram(slugCodec, options),
    ],
  };
}
