/**
 * The example renderer's own render policy, authored entirely through `@pmndrs/glyph/core`.
 *
 * A host does not borrow the Three policy: it supplies its own system lanes and compiles the
 * shared portable technique body into validated policy bytes.
 */
import {
  compileRenderPolicy,
  createRasterPolicyProgram,
  definePolicyBuffers,
  id,
  RenderWireIdentityRegistry,
  textShaperAbi,
  type PolicyBufferId,
  type PolicyHandle,
} from '@pmndrs/glyph/core';
import { glyphExamplePlanProgram } from '@pmndrs/glyph-example-raster';

const EXAMPLE_STABLE_GLYPH_BUFFER_ID: PolicyBufferId = id('buffer', 'glyph-example-renderer/stable-glyph');

/** The policy's own system lane: glyph identity that survives reflow within a paragraph. */
export const exampleSystemBuffers: {
  readonly stableGlyphId: {
    readonly id: typeof EXAMPLE_STABLE_GLYPH_BUFFER_ID;
    readonly scalar: 'u32';
    readonly lanes: readonly ['stableGlyphId'];
  };
} = definePolicyBuffers({
  stableGlyphId: { id: EXAMPLE_STABLE_GLYPH_BUFFER_ID, scalar: 'u32', lanes: ['stableGlyphId'] },
});

export const EXAMPLE_POLICY_HANDLE: PolicyHandle = id('policy', 'glyph-example-renderer');
export const EXAMPLE_RENDERER_PROGRAM_NAMESPACE = 'example-renderer';

/** Assemble the portable glyph-example body with this engine's own policy numbers. */
export function exampleRenderPolicyBytes(
  identities: RenderWireIdentityRegistry = new RenderWireIdentityRegistry(),
): Uint8Array {
  const capabilitySet = exampleCapabilitySet();
  return compileRenderPolicy({
    capabilitySets: [capabilitySet],
    programs: [
      createRasterPolicyProgram(glyphExamplePlanProgram, {
        namespace: EXAMPLE_RENDERER_PROGRAM_NAMESPACE,
        system: exampleSystemBuffers,
        capabilitySet,
        transformMode: 'direct',
        allocationMode: 'ordered',
        identityRegistry: identities,
      }),
    ],
  });
}

function exampleCapabilitySet() {
  return {
    flags:
      textShaperAbi.policy.capabilityFlags.storageBuffers |
      textShaperAbi.policy.capabilityFlags.aliasVec2 |
      textShaperAbi.policy.capabilityFlags.aliasVec4 |
      textShaperAbi.policy.capabilityFlags.orderedDirect,
    maxBufferBytes: 16 * 1024 * 1024,
    updateAlignment: 4,
    coalesceGapBytes: 128,
    rangeCallPenaltyBytes: 256,
    maxBuffersPerDraw: 8,
    maxResourcesPerDraw: 4,
    maxIndirectDraws: 0,
    fragmentationBudget: 8,
    wholeBufferThresholdBasisPoints: 7_500,
  };
}
