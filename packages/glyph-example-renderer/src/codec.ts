/** This renderer's Codec: compiles the shared portable technique body plus this host's own system lanes into Codec bytes. */
import { type CodecIdFactory, type CodecBufferId, type CodecCapabilitySet, type CodecDescriptor } from '@pmndrs/glyph';
import { compileCodec, id } from '@pmndrs/glyph/config/codec';
import { createRasterCodecProgram } from '@pmndrs/glyph/config/raster';
import { defineCodecBuffers } from '@pmndrs/glyph/config/schema';
import { glyphExampleCodec } from '@pmndrs/glyph-example-raster';

const EXAMPLE_OCCURRENCE_BUFFER_ID: CodecBufferId = id.buffer('glyph-example-renderer/occurrence');

/** The Codec's occurrence row: stable identity plus dynamic placement and host inputs. */
export const exampleSystemBuffers: {
  readonly occurrence: {
    readonly id: typeof EXAMPLE_OCCURRENCE_BUFFER_ID;
    readonly scalar: 'u32';
    readonly lanes: readonly ['stableGlyphId', 'placementSlot', 'transformIndex', 'foregroundRgba'];
  };
} = defineCodecBuffers({
  occurrence: {
    id: EXAMPLE_OCCURRENCE_BUFFER_ID,
    scalar: 'u32',
    lanes: ['stableGlyphId', 'placementSlot', 'transformIndex', 'foregroundRgba'],
  },
});

/** Stable namespace used to derive this renderer's numeric program identity. */
export const EXAMPLE_RENDERER_PROGRAM_NAMESPACE = 'example-renderer';

/** Assemble the portable glyph-example body with this handle's own Codec identities. */
export function exampleCodecBytes(ids?: CodecIdFactory): Uint8Array {
  return compileCodec(exampleCodecDescriptor(ids));
}

/** Builds this renderer's Codec descriptor from portable technique metadata. */
export function exampleCodecDescriptor(ids?: CodecIdFactory): CodecDescriptor {
  const capabilitySet = exampleCodecCapabilitySet;
  return Object.freeze({
    capabilitySets: [capabilitySet],
    programs: [
      createRasterCodecProgram(glyphExampleCodec, {
        namespace: EXAMPLE_RENDERER_PROGRAM_NAMESPACE,
        system: exampleSystemBuffers,
        capabilitySet,
        transformMode: 'direct',
        allocationMode: 'ordered',
        ...(ids === undefined ? {} : { ids }),
      }),
    ],
  });
}

/** Concrete limits and capabilities accepted by the example renderer. */
export const exampleCodecCapabilitySet: CodecCapabilitySet = Object.freeze({
  capabilities: Object.freeze(['storage-buffers', 'alias-vec2', 'alias-vec4', 'ordered-direct'] as const),
  maxBufferBytes: 16 * 1024 * 1024,
  updateAlignment: 4,
  coalesceGapBytes: 128,
  rangeCallPenaltyBytes: 256,
  maxBuffersPerDraw: 8,
  maxResourcesPerDraw: 4,
  maxIndirectDraws: 0,
  fragmentationBudget: 8,
  wholeBufferThresholdBasisPoints: 7_500,
});
