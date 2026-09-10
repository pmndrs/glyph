import type { CodecBufferId, CodecCapabilitySet, CodecDescriptor, CodecIdFactory } from '../../index.js';
import { id } from '../../config/codec.js';
import { defineCodecBuffers } from '../../config/schema.js';
import { createRasterCodecProgram } from '../../config/raster.js';
import { bitmapCodec } from '../../raster/bitmap.js';
import { msdfCodec } from '../../raster/msdf.js';
import { slugCodec } from '../../raster/slug.js';

const system = defineCodecBuffers({
  stableGlyphId: { id: id.buffer('glyph-typegpu/stable-glyph'), scalar: 'u32', lanes: ['stableGlyphId'] },
  placementSlot: { id: id.buffer('glyph-typegpu/placement-slot'), scalar: 'u32', lanes: ['placementSlot'] },
});
export const TYPEGPU_PLACEMENT_SLOT_BUFFER_ID: CodecBufferId = system.placementSlot.id;
const capabilitySet: CodecCapabilitySet = {
  capabilities: ['storage-buffers', 'alias-vec2', 'alias-vec4', 'ordered-direct'],
  maxBufferBytes: 16 * 1024 * 1024,
  updateAlignment: 4,
  coalesceGapBytes: 128,
  rangeCallPenaltyBytes: 256,
  maxBuffersPerDraw: 9,
  maxResourcesPerDraw: 4,
  maxIndirectDraws: 0,
  fragmentationBudget: 8,
  wholeBufferThresholdBasisPoints: 7500,
};
export function codecDescriptor(ids: CodecIdFactory): CodecDescriptor {
  const options = {
    ids,
    namespace: 'typegpu',
    system,
    capabilitySet,
    transformMode: 'direct',
    allocationMode: 'ordered',
  } as const;
  return {
    capabilitySets: [capabilitySet],
    programs: [
      createRasterCodecProgram(bitmapCodec, options),
      createRasterCodecProgram(msdfCodec, options),
      createRasterCodecProgram(slugCodec, options),
    ],
  };
}
