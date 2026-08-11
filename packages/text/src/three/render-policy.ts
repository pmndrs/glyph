import {
  addF32,
  compileRenderPolicy,
  constantF32,
  constantU32,
  createProgram,
  floatBuffers,
  multiplyF32,
  policyProgram,
  RenderWireIdentityRegistry,
  subtractF32,
  u32Buffers,
  u32ToF32,
  type PolicyAllocationMode,
  type PolicyBuffer,
  type PolicyCapabilitySet,
  type PolicyProgram,
  type PolicyTransformMode,
} from '../core.js';
import { textShaperAbi } from '../core.js';

export const TRANSFORM_BUFFER_ID = 15;

export const STABLE_GLYPH_BUFFER_ID = 14;

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

// Buffer ids are wire integers; these names map each technique's physical buffers
// to what its shader reads from them.
const BITMAP_ORIGIN = 1;
const BITMAP_SIZE = 2;
const BITMAP_UV_ORIGIN = 3;
const BITMAP_UV_SIZE = 4;
const BITMAP_COLOR = 5;
const BITMAP_PAGE = 6;
const MSDF_RECT = 1;
const MSDF_UV_RECT = 2;
const MSDF_UV_BOUNDS = 3;
const MSDF_COLOR = 4;
const MSDF_EFFECT_A = 5;
const MSDF_EFFECT_B = 6;
const MSDF_PAGE = 7;
const SLUG_RECT = 1;
const SLUG_PLANE_RECT = 2;
const SLUG_BAND_TRANSFORM = 3;
const SLUG_COLOR = 4;
const SLUG_INVERSE_FONT_SIZE = 5;
const SLUG_TABLE_STARTS = 6;
const SLUG_BAND_COUNTS = 7;
const DECORATION_RECT = 1;
const DECORATION_PACKED = 2;

function bitmapProgram(
  techniqueId: number,
  programId: number,
  transformMode: ThreeTransformMode,
  allocationMode: ThreeAllocationMode,
): PolicyProgram {
  const p = policyProgram({
    scope: 'strike',
    bindingF32: ['bearingX', 'bearingY', 'width', 'height', 'uvOriginX', 'uvOriginY', 'uvSizeX', 'uvSizeY'],
    bindingU32: ['page'],
  });
  const { inlineOrigin, blockOrigin, fontSize, color, transformIndex, stableGlyphId } = p.semantics;
  const { bearingX, bearingY, width, height, uvOriginX, uvOriginY, uvSizeX, uvSizeY, page } = p.binding;
  p.storeF32(BITMAP_ORIGIN, [
    addF32(inlineOrigin, multiplyF32(bearingX, fontSize)),
    subtractF32(blockOrigin, multiplyF32(bearingY, fontSize)),
  ]);
  p.storeF32(BITMAP_SIZE, [multiplyF32(width, fontSize), multiplyF32(height, fontSize)]);
  p.storeF32(BITMAP_UV_ORIGIN, [uvOriginX, uvOriginY]);
  p.storeF32(BITMAP_UV_SIZE, [uvSizeX, uvSizeY]);
  p.storeF32(BITMAP_COLOR, [color.red, color.green, color.blue, color.alpha]);
  if (transformMode === 'indexed') p.storeU32(TRANSFORM_BUFFER_ID, [transformIndex]);
  p.storeU32(STABLE_GLYPH_BUFFER_ID, [stableGlyphId]);
  p.storeU32(BITMAP_PAGE, [page]);
  return createProgram(
    techniqueId,
    programId,
    p.compile(),
    transformMode === 'indexed'
      ? [...floatBuffers([2, 2, 2, 2, 4]), ...u32Buffers([1], 6), stableGlyphIdBuffer(), transformIndexBuffer()]
      : [...floatBuffers([2, 2, 2, 2, 4]), ...u32Buffers([1], 6), stableGlyphIdBuffer()],
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
  const p = policyProgram({
    scope: 'glyph',
    bindingF32: [
      'bearingX',
      'bearingY',
      'width',
      'height',
      'uvOriginX',
      'uvOriginY',
      'uvSizeX',
      'uvSizeY',
      'uvMaxX',
      'uvMaxY',
    ],
    bindingU32: ['page'],
  });
  const { inlineOrigin, blockOrigin, fontSize, color, transformIndex, stableGlyphId } = p.semantics;
  const { bearingX, bearingY, width, height, uvOriginX, uvOriginY, uvSizeX, uvSizeY, uvMaxX, uvMaxY, page } = p.binding;
  const zero = constantF32(0);
  p.storeF32(MSDF_RECT, [
    addF32(inlineOrigin, multiplyF32(bearingX, fontSize)),
    subtractF32(blockOrigin, multiplyF32(bearingY, fontSize)),
    multiplyF32(width, fontSize),
    multiplyF32(height, fontSize),
  ]);
  p.storeF32(MSDF_UV_RECT, [uvOriginX, uvOriginY, uvSizeX, uvSizeY]);
  p.storeF32(MSDF_UV_BOUNDS, [uvOriginX, uvOriginY, uvMaxX, uvMaxY]);
  p.storeF32(MSDF_COLOR, [color.red, color.green, color.blue, color.alpha]);
  p.storeF32(MSDF_EFFECT_A, [zero, zero, zero, zero]);
  p.storeF32(MSDF_EFFECT_B, [zero, zero, zero, zero]);
  p.storeF32(MSDF_PAGE, [zero, zero, zero, u32ToF32(page)]);
  if (transformMode === 'indexed') p.storeU32(TRANSFORM_BUFFER_ID, [transformIndex]);
  p.storeU32(STABLE_GLYPH_BUFFER_ID, [stableGlyphId]);
  return createProgram(
    techniqueId,
    programId,
    p.compile(),
    [
      ...floatBuffers([4, 4, 4, 4, 4, 4, 4]),
      stableGlyphIdBuffer(),
      ...(transformMode === 'indexed' ? [transformIndexBuffer()] : []),
    ],
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
  const p = policyProgram({
    scope: 'glyph',
    inverseFontSize: true,
    bindingF32: ['bearingX', 'bearingY', 'width', 'height', 'bandScaleX', 'bandScaleY', 'bandOffsetX', 'bandOffsetY'],
    bindingU32: ['curveStart', 'headerStart', 'referenceStart', 'bandStart', 'horizontalBands', 'verticalBands'],
  });
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
  p.storeF32(SLUG_RECT, [
    addF32(inlineOrigin, multiplyF32(bearingX, fontSize)),
    subtractF32(blockOrigin, multiplyF32(bearingY, fontSize)),
    multiplyF32(width, fontSize),
    multiplyF32(height, fontSize),
  ]);
  p.storeF32(SLUG_PLANE_RECT, [bearingX, bearingY, width, height]);
  p.storeF32(SLUG_BAND_TRANSFORM, [bandScaleX, bandScaleY, bandOffsetX, bandOffsetY]);
  p.storeF32(SLUG_COLOR, [color.red, color.green, color.blue, color.alpha]);
  p.storeF32(SLUG_INVERSE_FONT_SIZE, [inverseFontSize, zeroF32, zeroF32, zeroF32]);
  p.storeU32(SLUG_TABLE_STARTS, [curveStart, headerStart, referenceStart, bandStart]);
  p.storeU32(SLUG_BAND_COUNTS, [horizontalBands, verticalBands, zeroU32, zeroU32]);
  if (transformMode === 'indexed') p.storeU32(TRANSFORM_BUFFER_ID, [transformIndex]);
  p.storeU32(STABLE_GLYPH_BUFFER_ID, [stableGlyphId]);
  return createProgram(
    techniqueId,
    programId,
    p.compile(),
    [
      ...floatBuffers([4, 4, 4, 4, 4]),
      ...u32Buffers([4, 4], 6),
      stableGlyphIdBuffer(),
      ...(transformMode === 'indexed' ? [transformIndexBuffer()] : []),
    ],
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
  const p = policyProgram({ scope: 'glyph', bindingU32: ['color', 'flags'] });
  const { inlineOrigin, blockOrigin, fontSize, color, transformIndex, stableGlyphId } = p.semantics;
  p.storeF32(DECORATION_RECT, [inlineOrigin, blockOrigin, fontSize, color.red]);
  p.storeU32(DECORATION_PACKED, [p.binding.color, p.binding.flags]);
  if (transformMode === 'indexed') p.storeU32(TRANSFORM_BUFFER_ID, [transformIndex]);
  p.storeU32(STABLE_GLYPH_BUFFER_ID, [stableGlyphId]);
  return {
    ...createProgram(
      techniqueId,
      programId,
      p.compile(),
      transformMode === 'indexed'
        ? [...floatBuffers([4]), ...u32Buffers([2], 2), stableGlyphIdBuffer(), transformIndexBuffer()]
        : [...floatBuffers([4]), ...u32Buffers([2], 2), stableGlyphIdBuffer()],
      transformMode,
      allocationMode,
    ),
    primitiveKind: textShaperAbi.engine.primitiveKinds.decoration,
    resourceKindMask: 0,
  };
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
