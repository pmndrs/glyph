import {
  addF32,
  compileRenderPolicy,
  constantF32,
  constantU32,
  createProgram,
  definePolicyBuffers,
  defineTechniqueSchema,
  multiplyF32,
  RenderWireIdentityRegistry,
  schemaPolicyBuffers,
  subtractF32,
  techniqueProgram,
  u32ToF32,
  type PolicyAllocationMode,
  type PolicyBuffer,
  type PolicyCapabilitySet,
  type PolicyProgram,
  type PolicyTransformMode,
  type TechniqueSchema,
} from '../core.js';
import { bitmapSchema } from '../raster/bitmap-technique.js';
import { msdfSchema } from '../raster/msdf.js';
import { slugSchema } from '../raster/slug-technique.js';
import { textShaperAbi } from '../core.js';

/** Buffers the Three policy itself owns, shared by every program in it. */
export const threeSystemBuffers: {
  readonly stableGlyphId: { readonly id: 14; readonly scalar: 'u32'; readonly lanes: readonly ['stableGlyphId'] };
  readonly transformIndex: { readonly id: 15; readonly scalar: 'u32'; readonly lanes: readonly ['transformIndex'] };
} = definePolicyBuffers({
  stableGlyphId: { id: 14, scalar: 'u32', lanes: ['stableGlyphId'] },
  transformIndex: { id: 15, scalar: 'u32', lanes: ['transformIndex'] },
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

/** Compiler-mapped Three policy covering every first-party raster technique in one registration. */
export function threeRenderPolicyBytes(
  identities: RenderWireIdentityRegistry = new RenderWireIdentityRegistry(),
  transformMode: ThreeTransformMode | ThreeTechniqueTransformModes = 'indexed',
  additionalPrograms: readonly PolicyProgram[] = [],
  allocationMode: ThreeAllocationMode = 'ordered',
): Uint8Array {
  const bitmap = identities.resolve('pmndrs.bitmap');
  const msdf = identities.resolve('pmndrs.msdf');
  const slug = identities.resolve('pmndrs.slug');
  const decoration = identities.resolve('pmndrs.decoration');
  const modes =
    typeof transformMode === 'string'
      ? { bitmap: transformMode, msdf: transformMode, slug: transformMode }
      : transformMode;
  const programs: PolicyProgram[] = [
    bitmapProgram(bitmap, 1, modes.bitmap, allocationMode),
    msdfProgram(msdf, 2, modes.msdf, allocationMode),
    slugProgram(slug, 3, modes.slug, allocationMode),
    decorationProgram(decoration, 4, modes.bitmap, allocationMode),
    ...additionalPrograms,
  ];
  if (new Set(programs.map((program) => program.techniqueId)).size !== programs.length) {
    throw new TypeError('first-party raster technique wire identities collide');
  }
  return compileRenderPolicy({ capabilitySets: [threeCapabilitySet()], programs });
}

function threeCapabilitySet(): PolicyCapabilitySet {
  const flags = textShaperAbi.policy.capabilityFlags;
  return {
    id: 1,
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
  techniqueId: number,
  programId: number,
  transformMode: ThreeTransformMode,
  allocationMode: ThreeAllocationMode,
): PolicyProgram {
  const p = techniqueProgram(bitmapSchema);
  const { inlineOrigin, blockOrigin, fontSize, color, transformIndex, stableGlyphId } = p.semantics;
  const { bearingX, bearingY, width, height, uvOriginX, uvOriginY, uvSizeX, uvSizeY, page } = p.binding;
  p.store(bitmapSchema.buffers.origin, [
    addF32(inlineOrigin, multiplyF32(bearingX, fontSize)),
    subtractF32(blockOrigin, multiplyF32(bearingY, fontSize)),
  ]);
  p.store(bitmapSchema.buffers.size, [multiplyF32(width, fontSize), multiplyF32(height, fontSize)]);
  p.store(bitmapSchema.buffers.uvOrigin, [uvOriginX, uvOriginY]);
  p.store(bitmapSchema.buffers.uvSize, [uvSizeX, uvSizeY]);
  p.store(bitmapSchema.buffers.color, [color.red, color.green, color.blue, color.alpha]);
  if (transformMode === 'indexed') p.store(threeSystemBuffers.transformIndex, [transformIndex]);
  p.store(threeSystemBuffers.stableGlyphId, [stableGlyphId]);
  p.store(bitmapSchema.buffers.page, [page]);
  return createProgram(
    techniqueId,
    programId,
    p.compile(),
    programBuffers(bitmapSchema, transformMode),
    transformMode,
    allocationMode,
  );
}

function msdfProgram(
  techniqueId: number,
  programId: number,
  transformMode: ThreeTransformMode,
  allocationMode: ThreeAllocationMode,
): PolicyProgram {
  const p = techniqueProgram(msdfSchema);
  const { inlineOrigin, blockOrigin, fontSize, color, transformIndex, stableGlyphId } = p.semantics;
  const { bearingX, bearingY, width, height, uvOriginX, uvOriginY, uvSizeX, uvSizeY, uvMaxX, uvMaxY, page } = p.binding;
  const zero = constantF32(0);
  p.store(msdfSchema.buffers.rect, [
    addF32(inlineOrigin, multiplyF32(bearingX, fontSize)),
    subtractF32(blockOrigin, multiplyF32(bearingY, fontSize)),
    multiplyF32(width, fontSize),
    multiplyF32(height, fontSize),
  ]);
  p.store(msdfSchema.buffers.uvRect, [uvOriginX, uvOriginY, uvSizeX, uvSizeY]);
  p.store(msdfSchema.buffers.uvBounds, [uvOriginX, uvOriginY, uvMaxX, uvMaxY]);
  p.store(msdfSchema.buffers.color, [color.red, color.green, color.blue, color.alpha]);
  p.store(msdfSchema.buffers.effectA, [zero, zero, zero, zero]);
  p.store(msdfSchema.buffers.effectB, [zero, zero, zero, zero]);
  p.store(msdfSchema.buffers.page, [zero, zero, zero, u32ToF32(page)]);
  if (transformMode === 'indexed') p.store(threeSystemBuffers.transformIndex, [transformIndex]);
  p.store(threeSystemBuffers.stableGlyphId, [stableGlyphId]);
  return createProgram(
    techniqueId,
    programId,
    p.compile(),
    programBuffers(msdfSchema, transformMode),
    transformMode,
    allocationMode,
  );
}

function slugProgram(
  techniqueId: number,
  programId: number,
  transformMode: ThreeTransformMode,
  allocationMode: ThreeAllocationMode,
): PolicyProgram {
  const p = techniqueProgram(slugSchema, { inverseFontSize: true });
  const { inlineOrigin, blockOrigin, fontSize, color, transformIndex, stableGlyphId } = p.semantics;
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
  const zeroF32 = constantF32(0);
  const zeroU32 = constantU32(0);
  p.store(slugSchema.buffers.rect, [
    addF32(inlineOrigin, multiplyF32(bearingX, fontSize)),
    subtractF32(blockOrigin, multiplyF32(bearingY, fontSize)),
    multiplyF32(width, fontSize),
    multiplyF32(height, fontSize),
  ]);
  p.store(slugSchema.buffers.planeRect, [bearingX, bearingY, width, height]);
  p.store(slugSchema.buffers.bandTransform, [bandScaleX, bandScaleY, bandOffsetX, bandOffsetY]);
  p.store(slugSchema.buffers.color, [color.red, color.green, color.blue, color.alpha]);
  p.store(slugSchema.buffers.inverseFontSize, [inverseFontSize, zeroF32, zeroF32, zeroF32]);
  p.store(slugSchema.buffers.tableStarts, [curveStart, headerStart, referenceStart, bandStart]);
  p.store(slugSchema.buffers.bandCounts, [horizontalBands, verticalBands, zeroU32, zeroU32]);
  if (transformMode === 'indexed') p.store(threeSystemBuffers.transformIndex, [transformIndex]);
  p.store(threeSystemBuffers.stableGlyphId, [stableGlyphId]);
  return createProgram(
    techniqueId,
    programId,
    p.compile(),
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
  techniqueId: number,
  programId: number,
  transformMode: ThreeTransformMode,
  allocationMode: ThreeAllocationMode,
): PolicyProgram {
  const p = techniqueProgram(decorationSchema);
  const { inlineOrigin, blockOrigin, fontSize, color, transformIndex, stableGlyphId } = p.semantics;
  p.store(decorationSchema.buffers.rect, [inlineOrigin, blockOrigin, fontSize, color.red]);
  p.store(decorationSchema.buffers.packed, [p.binding.color, p.binding.flags]);
  if (transformMode === 'indexed') p.store(threeSystemBuffers.transformIndex, [transformIndex]);
  p.store(threeSystemBuffers.stableGlyphId, [stableGlyphId]);
  return {
    ...createProgram(
      techniqueId,
      programId,
      p.compile(),
      programBuffers(decorationSchema, transformMode),
      transformMode,
      allocationMode,
    ),
    primitiveKind: textShaperAbi.engine.primitiveKinds.decoration,
    resourceKindMask: 0,
  };
}

/** Every Three program publishes its schema's buffers, then the policy's own system buffers. */
function programBuffers(schema: TechniqueSchema, transformMode: ThreeTransformMode): PolicyBuffer[] {
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
