import {
  compileRenderPolicy,
  createProgram,
  definePolicyBuffers,
  defineTechniqueSchema,
  f32,
  RenderWireIdentityRegistry,
  schemaPolicyBuffers,
  techniqueProgram,
  u32,
  type PolicyAllocationMode,
  type PolicyBuffer,
  type PolicyCapabilitySet,
  type PolicyProgram,
  type PolicyTransformMode,
  type RenderProgramId,
  type RenderTechniqueId,
  type AnyTechniqueSchema,
  type TechniqueSchema,
} from '../core.js';
import { bitmap, bitmapSchema } from '../raster/bitmap-technique.js';
import { msdf, msdfSchema } from '../raster/msdf.js';
import { slug, slugSchema } from '../raster/slug-technique.js';
import { textShaperAbi } from '../core.js';

const THREE_STABLE_GLYPH_BUFFER_ID = 14;
const THREE_TRANSFORM_INDEX_BUFFER_ID = 15;
export const THREE_CAPABILITY_SET_ID = 1;

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

export const TRANSFORM_BUFFER_ID: number = threeSystemBuffers.transformIndex.id;

export const STABLE_GLYPH_BUFFER_ID: number = threeSystemBuffers.stableGlyphId.id;

/**
 * Decoration is a reserved technique of the Three policy rather than a raster
 * technique: rows are resource-free and fill the gather lanes directly.
 */
export const decorationSchema: TechniqueSchema<
  {
    readonly rect: {
      readonly id: 1;
      readonly scalar: 'f32';
      readonly lanes: readonly ['left', 'top', 'width', 'height'];
    };
    readonly packed: { readonly id: 2; readonly scalar: 'u32'; readonly lanes: readonly ['color', 'flags'] };
  },
  { readonly u32: readonly ['color', 'flags'] }
> = defineTechniqueSchema({
  technique: 'pmndrs.decoration',
  scope: 'glyph',
  binding: { u32: ['color', 'flags'] },
  buffers: {
    rect: { id: 1, scalar: 'f32', lanes: ['left', 'top', 'width', 'height'] },
    packed: { id: 2, scalar: 'u32', lanes: ['color', 'flags'] },
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
  identityRegistry: RenderWireIdentityRegistry = new RenderWireIdentityRegistry(),
  transformMode: ThreeTransformMode | ThreeTechniqueTransformModes = 'indexed',
  additionalPrograms: readonly PolicyProgram[] = [],
  allocationMode: ThreeAllocationMode = 'ordered',
): Uint8Array {
  if (!(identityRegistry instanceof RenderWireIdentityRegistry)) {
    throw new TypeError('Three render policy identityRegistry must be a RenderWireIdentityRegistry');
  }
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
  const BITMAP_TECHNIQUE_ID = identityRegistry.techniqueId(bitmap);
  const MSDF_TECHNIQUE_ID = identityRegistry.techniqueId(msdf);
  const SLUG_TECHNIQUE_ID = identityRegistry.techniqueId(slug);
  const DECORATION_TECHNIQUE_ID = identityRegistry.techniqueId(decorationSchema.technique);
  const BITMAP_PROGRAM_ID = identityRegistry.programId(bitmap, THREE_PROGRAM_NAMESPACE);
  const MSDF_PROGRAM_ID = identityRegistry.programId(msdf, THREE_PROGRAM_NAMESPACE);
  const SLUG_PROGRAM_ID = identityRegistry.programId(slug, THREE_PROGRAM_NAMESPACE);
  const DECORATION_PROGRAM_ID = identityRegistry.programId(decorationSchema.technique, THREE_PROGRAM_NAMESPACE);
  const programs: PolicyProgram[] = [
    bitmapProgram(BITMAP_TECHNIQUE_ID, BITMAP_PROGRAM_ID, modes.bitmap, allocationMode),
    msdfProgram(MSDF_TECHNIQUE_ID, MSDF_PROGRAM_ID, modes.msdf, allocationMode),
    slugProgram(SLUG_TECHNIQUE_ID, SLUG_PROGRAM_ID, modes.slug, allocationMode),
    decorationProgram(DECORATION_TECHNIQUE_ID, DECORATION_PROGRAM_ID, modes.bitmap, allocationMode),
    ...additionalPrograms,
  ];
  return compileRenderPolicy({ capabilitySets: [threePolicyCapabilitySet()], programs });
}

export function threePolicyCapabilitySet(): PolicyCapabilitySet {
  const flags = textShaperAbi.policy.capabilityFlags;
  return {
    id: THREE_CAPABILITY_SET_ID,
    flags: flags.storageBuffers | flags.aliasVec2 | flags.aliasVec4 | flags.orderedDirect | flags.stableIndirect,
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

function bitmapProgram(
  techniqueId: RenderTechniqueId,
  programId: RenderProgramId,
  transformMode: ThreeTransformMode,
  allocationMode: ThreeAllocationMode,
): PolicyProgram {
  const p = techniqueProgram(bitmapSchema, { system: policySystemBuffers(transformMode) });
  const { inlineOrigin, blockOrigin, fontSize, color } = p.semantics;
  const { bearingX, bearingY, width, height, uvOriginX, uvOriginY, uvSizeX, uvSizeY, page } = p.binding;
  // Convert the baked em-space bearing and dimensions into the layout's pixel-space ink box.
  return createProgram(
    techniqueId,
    programId,
    p.compile({
      origin: [f32.add(inlineOrigin, f32.mul(bearingX, fontSize)), f32.sub(blockOrigin, f32.mul(bearingY, fontSize))],
      size: [f32.mul(width, fontSize), f32.mul(height, fontSize)],
      uvOrigin: [uvOriginX, uvOriginY],
      uvSize: [uvSizeX, uvSizeY],
      color: [color.red, color.green, color.blue, color.alpha],
      page: [page],
    }),
    programBuffers(bitmapSchema, transformMode),
    transformMode,
    allocationMode,
  );
}

function msdfProgram(
  techniqueId: RenderTechniqueId,
  programId: RenderProgramId,
  transformMode: ThreeTransformMode,
  allocationMode: ThreeAllocationMode,
): PolicyProgram {
  const p = techniqueProgram(msdfSchema, { system: policySystemBuffers(transformMode) });
  const { inlineOrigin, blockOrigin, fontSize, color } = p.semantics;
  const { bearingX, bearingY, width, height, uvOriginX, uvOriginY, uvSizeX, uvSizeY, uvMaxX, uvMaxY, page } = p.binding;
  const zero = f32.const(0);
  // Effects default to disabled; the page occupies the shader contract's fourth f32 lane.
  return createProgram(
    techniqueId,
    programId,
    p.compile({
      rect: [
        f32.add(inlineOrigin, f32.mul(bearingX, fontSize)),
        f32.sub(blockOrigin, f32.mul(bearingY, fontSize)),
        f32.mul(width, fontSize),
        f32.mul(height, fontSize),
      ],
      uvRect: [uvOriginX, uvOriginY, uvSizeX, uvSizeY],
      uvBounds: [uvOriginX, uvOriginY, uvMaxX, uvMaxY],
      color: [color.red, color.green, color.blue, color.alpha],
      effectA: [zero, zero, zero, zero],
      effectB: [zero, zero, zero, zero],
      page: [zero, zero, zero, u32.toF32(page)],
    }),
    programBuffers(msdfSchema, transformMode),
    transformMode,
    allocationMode,
  );
}

function slugProgram(
  techniqueId: RenderTechniqueId,
  programId: RenderProgramId,
  transformMode: ThreeTransformMode,
  allocationMode: ThreeAllocationMode,
): PolicyProgram {
  const p = techniqueProgram(slugSchema, { inverseFontSize: true, system: policySystemBuffers(transformMode) });
  const { inlineOrigin, blockOrigin, fontSize, color } = p.semantics;
  const inverseFontSize = p.semantics.inverseFontSize;
  if (inverseFontSize === undefined) throw new TypeError('the Slug program declares inverseFontSize');
  const {
    bearingX,
    bearingY,
    width,
    height,
    bandScaleX,
    bandScaleY,
    bandOffsetX,
    bandOffsetY,
    curveStart,
    headerStart,
    referenceStart,
    bandStart,
    horizontalBands,
    verticalBands,
  } = p.binding;
  const zeroF32 = f32.const(0);
  const zeroU32 = u32.const(0);
  // `rect` is layout pixels; `planeRect` preserves the baked em-space hull coordinates.
  return createProgram(
    techniqueId,
    programId,
    p.compile({
      rect: [
        f32.add(inlineOrigin, f32.mul(bearingX, fontSize)),
        f32.sub(blockOrigin, f32.mul(bearingY, fontSize)),
        f32.mul(width, fontSize),
        f32.mul(height, fontSize),
      ],
      planeRect: [bearingX, bearingY, width, height],
      bandTransform: [bandScaleX, bandScaleY, bandOffsetX, bandOffsetY],
      color: [color.red, color.green, color.blue, color.alpha],
      inverseFontSize: [inverseFontSize, zeroF32, zeroF32, zeroF32],
      tableStarts: [curveStart, headerStart, referenceStart, bandStart],
      bandCounts: [horizontalBands, verticalBands, zeroU32, zeroU32],
    }),
    programBuffers(slugSchema, transformMode),
    transformMode,
    allocationMode,
  );
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
    primitiveKind: textShaperAbi.engine.primitiveKinds.decoration,
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
    scalar: textShaperAbi.policy.scalarTypes.u32,
    vectorWidth: 1,
  };
}

function stableGlyphIdBuffer(): PolicyBuffer {
  return {
    id: STABLE_GLYPH_BUFFER_ID,
    scalar: textShaperAbi.policy.scalarTypes.u32,
    vectorWidth: 1,
  };
}
