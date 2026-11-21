import type { CodecBufferId, CodecCapabilitySet, CodecDescriptor, CodecIdFactory } from '../../index.js';
import { id } from '../../config/codec.js';
import { defineCodecBuffers } from '../../config/schema.js';
import { createHostRasterCodecProgram } from '../../config/raster-host.js';
import { bitmapCodec } from '../../raster/bitmap.js';
import { msdfCodec } from '../../raster/msdf.js';
import { slugCodec, slugSchema } from '../../raster/slug.js';

const system = defineCodecBuffers({
  stableGlyphId: { id: id.buffer('glyph-typegpu/stable-glyph'), scalar: 'u32', lanes: ['stableGlyphId'] },
  placementSlot: { id: id.buffer('glyph-typegpu/placement-slot'), scalar: 'u32', lanes: ['placementSlot'] },
  transformIndex: { id: id.buffer('glyph-typegpu/transform-index'), scalar: 'u32', lanes: ['transformIndex'] },
});
export const TYPEGPU_PLACEMENT_SLOT_BUFFER_ID: CodecBufferId = system.placementSlot.id;
/** Per-instance record in the renderer's transform table; MSDF and bitmap programs are indexed. */
export const TYPEGPU_TRANSFORM_INDEX_BUFFER_ID: CodecBufferId = system.transformIndex.id;
const capabilitySet: CodecCapabilitySet = {
  capabilities: ['storage-buffers', 'alias-vec2', 'alias-vec4', 'ordered-direct'],
  maxBufferBytes: 16 * 1024 * 1024,
  updateAlignment: 4,
  coalesceGapBytes: 128,
  rangeCallPenaltyBytes: 256,
  // Bitmap's six vertex lanes plus the placement-slot and transform-index storage lanes; stableGlyphId is
  // published but never bound.
  maxBuffersPerDraw: 9,
  maxResourcesPerDraw: 4,
  maxIndirectDraws: 0,
  fragmentationBudget: 8,
  wholeBufferThresholdBasisPoints: 7500,
};
export function codecDescriptor(ids: CodecIdFactory): CodecDescriptor {
  // Batched programs read each Text's offset from the transform table, so many Texts share one draw.
  const options = {
    ids,
    namespace: 'typegpu',
    system,
    capabilitySet,
    transformMode: 'indexed',
  } as const;
  // Slug keeps one draw per Text until its batching lands; with three technique lanes it has room for its own
  // transform-index buffer.
  const slugOptions = {
    ...options,
    system: { stableGlyphId: system.stableGlyphId, placementSlot: system.placementSlot },
    transformMode: 'direct',
    placementSlotTarget: { buffer: slugSchema.buffers.glyph.id, lane: 1 },
  } as const;
  return {
    capabilitySets: [capabilitySet],
    programs: [
      createHostRasterCodecProgram(bitmapCodec, options),
      createHostRasterCodecProgram(msdfCodec, options),
      createHostRasterCodecProgram(slugCodec, slugOptions),
    ],
  };
}
