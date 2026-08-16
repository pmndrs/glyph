import {
  compileRenderPolicy,
  createProgram,
  floatBuffers,
  programContext,
  stores,
  u32Buffers,
  type PolicyBuffer,
  type PolicyCapabilitySet,
  type PolicyProgram,
  RenderWireIdentityRegistry,
  type PolicyAllocationMode,
  type PolicyTransformMode,
} from '../core/render-policy.js';
import { textShaperAbi } from '../generated/text-shaper-abi.js';

export const FIRST_PARTY_TRANSFORM_BUFFER_ID = 15;

export const FIRST_PARTY_STABLE_GLYPH_BUFFER_ID = 14;

export type ThreeTransformMode = PolicyTransformMode;

export type ThreeAllocationMode = PolicyAllocationMode;

export interface ThreeTechniqueTransformModes {
  readonly bitmap: ThreeTransformMode;
  readonly msdf: ThreeTransformMode;
  readonly slug: ThreeTransformMode;
}

/** Compiler-mapped Three policy covering every first-party raster technique in one registration. */
export function firstPartyThreeRenderPolicyBytes(
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
  const context = programContext('strike', 8, 1);
  const { loadF32, loadU32, binary, storeF32, storeU32 } = context;
  loadF32(15);
  loadU32(31, 0);
  loadU32(30, 1);
  loadU32(29, 2);
  binary('multiplyF32', 15, 7, 2);
  binary('addF32', 16, 0, 15);
  binary('multiplyF32', 17, 8, 2);
  binary('subtractF32', 18, 1, 17);
  binary('multiplyF32', 19, 9, 2);
  binary('multiplyF32', 20, 10, 2);
  stores(storeF32, [
    [1, [16, 18]],
    [2, [19, 20]],
    [3, [11, 12]],
    [4, [13, 14]],
    [5, [3, 4, 5, 6]],
  ]);
  if (transformMode === 'indexed') storeU32(FIRST_PARTY_TRANSFORM_BUFFER_ID, 0, 31);
  storeU32(FIRST_PARTY_STABLE_GLYPH_BUFFER_ID, 0, 30);
  storeU32(6, 0, 29);
  return createProgram(
    techniqueId,
    programId,
    context,
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
  const context = programContext('glyph', 10, 1);
  const { operations, loadF32, loadU32, binary, constantF32, storeF32, storeU32 } = context;
  loadF32(17);
  loadU32(17, 2);
  loadU32(31, 0);
  loadU32(30, 1);
  binary('multiplyF32', 18, 7, 2);
  binary('addF32', 19, 0, 18);
  binary('multiplyF32', 20, 8, 2);
  binary('subtractF32', 21, 1, 20);
  binary('multiplyF32', 22, 9, 2);
  binary('multiplyF32', 23, 10, 2);
  operations.push({ opcode: textShaperAbi.policy.opcodes.convertU32ToF32, target: 24, operand0: 17 });
  constantF32(25, 0);
  stores(storeF32, [
    [1, [19, 21, 22, 23]],
    [2, [11, 12, 13, 14]],
    [3, [11, 12, 15, 16]],
    [4, [3, 4, 5, 6]],
    [5, [25, 25, 25, 25]],
    [6, [25, 25, 25, 25]],
    [7, [25, 25, 25, 24]],
  ]);
  if (transformMode === 'indexed') storeU32(FIRST_PARTY_TRANSFORM_BUFFER_ID, 0, 31);
  storeU32(FIRST_PARTY_STABLE_GLYPH_BUFFER_ID, 0, 30);
  return createProgram(
    techniqueId,
    programId,
    context,
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
  const context = programContext('glyph', 8, 6, true);
  const { loadF32, loadU32, binary, constantF32, constantU32, storeF32, storeU32 } = context;
  loadF32(16);
  loadU32(31, 0);
  loadU32(30, 1);
  for (let field = 0; field < 6; field += 1) loadU32(21 + field, field + 2);
  binary('multiplyF32', 16, 8, 2);
  binary('addF32', 17, 0, 16);
  binary('multiplyF32', 18, 9, 2);
  binary('subtractF32', 19, 1, 18);
  binary('multiplyF32', 20, 10, 2);
  binary('multiplyF32', 27, 11, 2);
  constantF32(28, 0);
  constantU32(29, 0);
  stores(storeF32, [
    [1, [17, 19, 20, 27]],
    [2, [8, 9, 10, 11]],
    [3, [12, 13, 14, 15]],
    [4, [3, 4, 5, 6]],
    [5, [7, 28, 28, 28]],
  ]);
  stores(storeU32, [
    [6, [21, 22, 23, 24]],
    [7, [25, 26, 29, 29]],
  ]);
  if (transformMode === 'indexed') storeU32(FIRST_PARTY_TRANSFORM_BUFFER_ID, 0, 31);
  storeU32(FIRST_PARTY_STABLE_GLYPH_BUFFER_ID, 0, 30);
  return createProgram(
    techniqueId,
    programId,
    context,
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
 * color, then flags — so the loads below read lanes by index; the semantic input
 * declarations exist to satisfy policy validation and are not sourced per glyph.
 */
function decorationProgram(
  techniqueId: number,
  programId: number,
  transformMode: ThreeTransformMode,
  allocationMode: ThreeAllocationMode,
): PolicyProgram {
  const context = programContext('glyph', 0, 2);
  const { loadF32, loadU32, storeF32, storeU32 } = context;
  loadF32(4);
  loadU32(28, 0);
  loadU32(29, 1);
  loadU32(30, 2);
  loadU32(31, 3);
  stores(storeF32, [[1, [0, 1, 2, 3]]]);
  storeU32(2, 0, 30);
  storeU32(2, 1, 31);
  if (transformMode === 'indexed') storeU32(FIRST_PARTY_TRANSFORM_BUFFER_ID, 0, 28);
  storeU32(FIRST_PARTY_STABLE_GLYPH_BUFFER_ID, 0, 29);
  return {
    ...createProgram(
      techniqueId,
      programId,
      context,
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
    id: FIRST_PARTY_TRANSFORM_BUFFER_ID,
    scalar: textShaperAbi.policy.scalarTypes.u32,
    vectorWidth: 1,
  };
}

function stableGlyphIdBuffer(): PolicyBuffer {
  return {
    id: FIRST_PARTY_STABLE_GLYPH_BUFFER_ID,
    scalar: textShaperAbi.policy.scalarTypes.u32,
    vectorWidth: 1,
  };
}
