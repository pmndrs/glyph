/**
 * The example renderer's own Codec, authored through the root GlyphConfig vocabulary.
 *
 * A host does not borrow the Three policy: it supplies its own system lanes and compiles the
 * shared portable technique body into validated policy bytes.
 */
import {
  compileCodec,
  createRasterCodecProgram,
  defineCodecBuffers,
  type CodecIdFactory,
  type CodecBufferId,
  type CodecCapabilitySet,
  type CodecDescriptor,
  id,
} from '@pmndrs/glyph';
import { glyphExamplePlanProgram } from '@pmndrs/glyph-example-raster';

const EXAMPLE_STABLE_GLYPH_BUFFER_ID: CodecBufferId = id.buffer('glyph-example-renderer/stable-glyph');

/** The Codec's own system lane: glyph identity that survives reflow within a paragraph. */
export const exampleSystemBuffers: {
  readonly stableGlyphId: {
    readonly id: typeof EXAMPLE_STABLE_GLYPH_BUFFER_ID;
    readonly scalar: 'u32';
    readonly lanes: readonly ['stableGlyphId'];
  };
} = defineCodecBuffers({
  stableGlyphId: { id: EXAMPLE_STABLE_GLYPH_BUFFER_ID, scalar: 'u32', lanes: ['stableGlyphId'] },
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
      createRasterCodecProgram(glyphExamplePlanProgram, {
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
