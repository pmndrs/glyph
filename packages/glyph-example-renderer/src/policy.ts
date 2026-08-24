/**
 * The example renderer's own render policy, authored entirely through `@pmndrs/glyph/core`.
 *
 * A host does not borrow the Three policy: it supplies its own system lanes and compiles the
 * shared portable technique body into validated policy bytes.
 */
import {
  compileRenderPolicy,
  createProgram,
  definePolicyBuffers,
  renderWireId,
  schemaPolicyBuffers,
  textShaperAbi,
} from '@pmndrs/glyph/core';
import { glyphExamplePlanProgram, glyphExampleSchema } from '@pmndrs/glyph-example-raster';

/** The policy's own system lane: glyph identity that survives reflow within a paragraph. */
export const exampleSystemBuffers: {
  readonly stableGlyphId: { readonly id: 20; readonly scalar: 'u32'; readonly lanes: readonly ['stableGlyphId'] };
} = definePolicyBuffers({
  stableGlyphId: { id: 20, scalar: 'u32', lanes: ['stableGlyphId'] },
});

export const EXAMPLE_CAPABILITY_SET = 1;
export const EXAMPLE_POLICY_HANDLE = 23;

/** Assemble the portable glyph-example body with this engine's own policy numbers. */
export function exampleRenderPolicyBytes(): Uint8Array {
  const p = glyphExamplePlanProgram.policyBody(exampleSystemBuffers, exampleCapabilitySet());
  return compileRenderPolicy({
    capabilitySets: [exampleCapabilitySet()],
    programs: [
      createProgram(
        renderWireId(glyphExamplePlanProgram.technique.id),
        1,
        p,
        [...schemaPolicyBuffers(glyphExampleSchema), stableGlyphIdBuffer()],
        'direct',
        'ordered',
      ),
    ],
  });
}

function exampleCapabilitySet() {
  return {
    id: EXAMPLE_CAPABILITY_SET,
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

function stableGlyphIdBuffer() {
  return {
    id: exampleSystemBuffers.stableGlyphId.id,
    scalar: textShaperAbi.policy.scalarTypes.u32,
    vectorWidth: 1,
  };
}
