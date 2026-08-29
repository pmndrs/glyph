import {
  compileRenderPolicy,
  createProgram,
  createRasterPolicyProgram,
  definePolicyBuffers,
  defineTechniqueSchema,
  id,
  schemaPolicyBuffers,
  techniqueProgram,
  type PolicyAllocationMode,
  type PolicyBuffer,
  type PolicyBufferId,
  type PolicyCapabilitySet,
  type PolicyDescriptor,
  type PolicyProgram,
  type PolicyTransformMode,
  type RenderProgramId,
  type RenderIdFactory,
  type RenderTechniqueId,
  type AnyTechniqueSchema,
  type TechniqueSchema,
} from '../core.js';
import { assertRenderIdFactory, RenderIdScope } from '../core/render-policy.js';
import { bitmapPlanProgram } from '../raster/bitmap-technique.js';
import { msdfPlanProgram } from '../raster/msdf.js';
import { slugPlanProgram } from '../raster/slug-technique.js';

const THREE_STABLE_GLYPH_BUFFER_ID: PolicyBufferId = id.buffer('glyph-three/stable-glyph');
const THREE_TRANSFORM_INDEX_BUFFER_ID: PolicyBufferId = id.buffer('glyph-three/transform-index');
const DECORATION_RECT_BUFFER_ID: PolicyBufferId = id.buffer('glyph-three/decoration/rect');
const DECORATION_PACKED_BUFFER_ID: PolicyBufferId = id.buffer('glyph-three/decoration/packed');

/** Buffers the Three policy itself owns, shared by every program in it. */
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
} = definePolicyBuffers({
  stableGlyphId: { id: THREE_STABLE_GLYPH_BUFFER_ID, scalar: 'u32', lanes: ['stableGlyphId'] },
  transformIndex: { id: THREE_TRANSFORM_INDEX_BUFFER_ID, scalar: 'u32', lanes: ['transformIndex'] },
});

export const TRANSFORM_BUFFER_ID: PolicyBufferId = threeSystemBuffers.transformIndex.id;

export const STABLE_GLYPH_BUFFER_ID: PolicyBufferId = threeSystemBuffers.stableGlyphId.id;

/**
 * Decoration is a reserved technique of the Three policy rather than a raster
 * technique: rows are resource-free and fill the gather lanes directly.
 */
export const decorationSchema: TechniqueSchema<
  {
    readonly rect: {
      readonly id: typeof DECORATION_RECT_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['left', 'top', 'width', 'height'];
    };
    readonly packed: {
      readonly id: typeof DECORATION_PACKED_BUFFER_ID;
      readonly scalar: 'u32';
      readonly lanes: readonly ['color', 'flags'];
    };
  },
  { readonly u32: readonly ['color', 'flags'] }
> = defineTechniqueSchema({
  technique: 'pmndrs.decoration',
  scope: 'glyph',
  binding: { u32: ['color', 'flags'] },
  buffers: {
    rect: { id: DECORATION_RECT_BUFFER_ID, scalar: 'f32', lanes: ['left', 'top', 'width', 'height'] },
    packed: { id: DECORATION_PACKED_BUFFER_ID, scalar: 'u32', lanes: ['color', 'flags'] },
  },
});

export type ThreeTransformMode = PolicyTransformMode;

export type ThreeAllocationMode = PolicyAllocationMode;

export interface ThreeTechniqueTransformModes {
  readonly bitmap: ThreeTransformMode;
  readonly msdf: ThreeTransformMode;
  readonly slug: ThreeTransformMode;
}

const THREE_PROGRAM_NAMESPACE = 'three';

/** Compiler-mapped Three policy covering every first-party raster technique in one registration. */
export function threeRenderPolicyBytes(
  ids: RenderIdFactory = new RenderIdScope(),
  transformMode: ThreeTransformMode | ThreeTechniqueTransformModes = 'indexed',
  additionalPrograms: readonly PolicyProgram[] = [],
  allocationMode: ThreeAllocationMode = 'ordered',
): Uint8Array {
  return compileRenderPolicy(threeRenderPolicyDescriptor(ids, transformMode, additionalPrograms, allocationMode));
}

/** @internal Assemble the descriptor retained by the Three adapter alongside its compiled wire policy. */
export function threeRenderPolicyDescriptor(
  ids: RenderIdFactory = new RenderIdScope(),
  transformMode: ThreeTransformMode | ThreeTechniqueTransformModes = 'indexed',
  additionalPrograms: readonly PolicyProgram[] = [],
  allocationMode: ThreeAllocationMode = 'ordered',
): PolicyDescriptor {
  assertRenderIdFactory(ids, 'Three render policy ids');
  if (!Array.isArray(additionalPrograms)) throw new TypeError('Three additional policy programs need an array');
  if (allocationMode !== 'ordered' && allocationMode !== 'stable') {
    throw new TypeError('Three allocation mode must be "ordered" or "stable"');
  }
  const modes =
    typeof transformMode === 'string'
      ? { bitmap: transformMode, msdf: transformMode, slug: transformMode }
      : { bitmap: transformMode?.bitmap, msdf: transformMode?.msdf, slug: transformMode?.slug };
  for (const [name, mode] of Object.entries(modes)) {
    if (mode !== 'direct' && mode !== 'indexed') {
      throw new TypeError(`Three ${name} transform mode must be "direct" or "indexed"`);
    }
  }
  const DECORATION_TECHNIQUE_ID = ids.technique(decorationSchema.technique);
  const DECORATION_PROGRAM_ID = ids.program(decorationSchema.technique, THREE_PROGRAM_NAMESPACE);
  const capabilitySet = threePolicyCapabilitySet();
  const programs: PolicyProgram[] = [
    createRasterPolicyProgram(bitmapPlanProgram, {
      namespace: THREE_PROGRAM_NAMESPACE,
      system: policySystemBuffers(modes.bitmap),
      capabilitySet,
      transformMode: modes.bitmap,
      allocationMode,
      ids,
    }),
    createRasterPolicyProgram(msdfPlanProgram, {
      namespace: THREE_PROGRAM_NAMESPACE,
      system: policySystemBuffers(modes.msdf),
      capabilitySet,
      transformMode: modes.msdf,
      allocationMode,
      ids,
    }),
    createRasterPolicyProgram(slugPlanProgram, {
      namespace: THREE_PROGRAM_NAMESPACE,
      system: policySystemBuffers(modes.slug),
      capabilitySet,
      transformMode: modes.slug,
      allocationMode,
      ids,
    }),
    decorationProgram(DECORATION_TECHNIQUE_ID, DECORATION_PROGRAM_ID, modes.bitmap, allocationMode),
    ...additionalPrograms,
  ];
  return { capabilitySets: [capabilitySet], programs };
}

export function threePolicyCapabilitySet(): PolicyCapabilitySet {
  return {
    capabilities: ['storage-buffers', 'alias-vec2', 'alias-vec4', 'ordered-direct', 'stable-indirect'],
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

/**
 * Resource-free decoration quads. Decoration rows fill the gather lanes directly —
 * f32 lanes 0-3 carry the rectangle and u32 lanes carry transform, stable identity,
 * color, then flags — so the semantic handles below address gather lanes by
 * position, not per-glyph meaning: the "inlineOrigin" lane is the rect's inline
 * start, and the paint arrives through the binding's packed u32 pair.
 */
function decorationProgram(
  techniqueId: RenderTechniqueId,
  programId: RenderProgramId,
  transformMode: ThreeTransformMode,
  allocationMode: ThreeAllocationMode,
): PolicyProgram {
  const p = techniqueProgram(decorationSchema, { system: policySystemBuffers(transformMode) });
  const { inlineOrigin, blockOrigin, fontSize, color } = p.semantics;
  return {
    ...createProgram(
      techniqueId,
      programId,
      p.compile({
        rect: [inlineOrigin, blockOrigin, fontSize, color.red],
        packed: [p.binding.color, p.binding.flags],
      }),
      programBuffers(decorationSchema, transformMode),
      transformMode,
      allocationMode,
    ),
    primitiveKind: 'decoration',
    resourceKindMask: 0,
  };
}

function policySystemBuffers(transformMode: ThreeTransformMode) {
  return transformMode === 'indexed' ? threeSystemBuffers : { stableGlyphId: threeSystemBuffers.stableGlyphId };
}

/** Every Three program publishes its schema's buffers, then the policy's own system buffers. */
function programBuffers(schema: AnyTechniqueSchema, transformMode: ThreeTransformMode): PolicyBuffer[] {
  return [
    ...schemaPolicyBuffers(schema),
    stableGlyphIdBuffer(),
    ...(transformMode === 'indexed' ? [transformIndexBuffer()] : []),
  ];
}

function transformIndexBuffer(): PolicyBuffer {
  return {
    id: TRANSFORM_BUFFER_ID,
    scalar: 'u32',
    vectorWidth: 1,
  };
}

function stableGlyphIdBuffer(): PolicyBuffer {
  return {
    id: STABLE_GLYPH_BUFFER_ID,
    scalar: 'u32',
    vectorWidth: 1,
  };
}
