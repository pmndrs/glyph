/**
 * The example renderer's own render policy, authored entirely through `@pmndrs/glyph/core`.
 *
 * A host does not borrow our Three policy: it declares its own technique schema, programs the
 * semantic lanes into its own buffers, and compiles validated policy bytes. This module is the
 * proof that `/core` alone is sufficient to do that.
 */
import {
  addF32,
  compileRenderPolicy,
  createProgram,
  definePolicyBuffers,
  defineTechniqueSchema,
  multiplyF32,
  renderWireId,
  schemaPolicyBuffers,
  subtractF32,
  techniqueProgram,
  textShaperAbi,
  type TechniqueSchema,
} from '@pmndrs/glyph/core';

/** The policy's own system lane: glyph identity that survives reflow within a paragraph. */
export const exampleSystemBuffers: {
  readonly stableGlyphId: { readonly id: 20; readonly scalar: 'u32'; readonly lanes: readonly ['stableGlyphId'] };
} = definePolicyBuffers({
  stableGlyphId: { id: 20, scalar: 'u32', lanes: ['stableGlyphId'] },
});

/**
 * A minimal quad technique. Its per-glyph binding arrives through the glyph scope: the
 * raster bearing and ink size, exactly what a bitmap-style host needs to place quads.
 */
export const exampleQuadSchema: TechniqueSchema<
  {
    readonly origin: { readonly id: 1; readonly scalar: 'f32'; readonly lanes: readonly ['left', 'top'] };
    readonly size: { readonly id: 2; readonly scalar: 'f32'; readonly lanes: readonly ['widthX', 'heightY'] };
    readonly color: {
      readonly id: 3;
      readonly scalar: 'f32';
      readonly lanes: readonly ['red', 'green', 'blue', 'alpha'];
    };
  },
  { readonly f32: readonly ['bearingX', 'bearingY', 'width', 'height'] }
> = defineTechniqueSchema({
  technique: 'example.quad',
  scope: 'glyph',
  binding: { f32: ['bearingX', 'bearingY', 'width', 'height'] },
  buffers: {
    origin: { id: 1, scalar: 'f32', lanes: ['left', 'top'] },
    size: { id: 2, scalar: 'f32', lanes: ['widthX', 'heightY'] },
    color: { id: 3, scalar: 'f32', lanes: ['red', 'green', 'blue', 'alpha'] },
  },
});

export const EXAMPLE_CAPABILITY_SET = 1;
export const EXAMPLE_POLICY_HANDLE = 23;

/** Compile this package's policy: one capability set and one quad program. */
export function exampleRenderPolicyBytes(): Uint8Array {
  const p = techniqueProgram(exampleQuadSchema);
  const { inlineOrigin, blockOrigin, fontSize, color, stableGlyphId } = p.semantics;
  const { bearingX, bearingY, width, height } = p.binding;
  p.store(exampleQuadSchema.buffers.origin, [
    addF32(inlineOrigin, multiplyF32(bearingX, fontSize)),
    subtractF32(blockOrigin, multiplyF32(bearingY, fontSize)),
  ]);
  p.store(exampleQuadSchema.buffers.size, [multiplyF32(width, fontSize), multiplyF32(height, fontSize)]);
  p.store(exampleQuadSchema.buffers.color, [color.red, color.green, color.blue, color.alpha]);
  p.store(exampleSystemBuffers.stableGlyphId, [stableGlyphId]);
  return compileRenderPolicy({
    capabilitySets: [
      {
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
      },
    ],
    programs: [
      createProgram(
        renderWireId('example.quad'),
        1,
        p.compile(),
        [...schemaPolicyBuffers(exampleQuadSchema), stableGlyphIdBuffer()],
        'indexed',
        'ordered',
      ),
    ],
  });
}

function stableGlyphIdBuffer() {
  return {
    id: exampleSystemBuffers.stableGlyphId.id,
    scalar: textShaperAbi.policy.scalarTypes.u32,
    vectorWidth: 1,
  };
}
