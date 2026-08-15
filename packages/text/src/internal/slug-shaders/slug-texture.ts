/**
 * Three.js/TSL resource access for PMNDRS_font_slug V0's exact R32UI header grid,
 * R16UI glyph-local reference grid, and RGBA16F curve grid.
 *
 * Only the addressing that exists because these resources are 2D textures lives
 * here; the header and reference bit layout belongs to the host-agnostic core.
 */
import tgpu, { d, std, type TgpuSlot } from 'typegpu';
import { slugReferenceFromPair } from './core/band.js';

export interface SlugShaderPage {
  readonly loadCurve: (coords: d.v2i) => d.v4f;
  readonly curveWidth: number;
  readonly loadHeader: (coords: d.v2i) => d.v4u;
  readonly headerWidth: number;
  readonly loadReference: (coords: d.v2i) => d.v4u;
  readonly referenceWidth: number;
}

export const SlugShaderCurve: d.WgslStruct<{ p0: d.Vec2f; p1: d.Vec2f; p2: d.Vec2f }> = d.struct({
  p0: d.vec2f,
  p1: d.vec2f,
  p2: d.vec2f,
});
export type SlugShaderCurve = d.InferGPU<typeof SlugShaderCurve>;

function gridCoordinate(index: /* u32 */ number, width: /* u32 */ number): d.v2i {
  'use gpu';
  const integerIndex = d.i32(index);
  const integerWidth = d.i32(width);

  return d.vec2i(integerIndex % integerWidth, std.intdiv(integerIndex, integerWidth));
}

export const pageSlot: TgpuSlot<SlugShaderPage> = tgpu.slot<SlugShaderPage>();

/**
 * @note Uses `pageSlot`
 */
export function loadHeader(index: /* u32 */ number): /* u32 */ number {
  'use gpu';
  const texel = pageSlot.$.loadHeader(gridCoordinate(index, pageSlot.$.headerWidth));
  return d.u32(texel.x);
}

/**
 * @note Uses `pageSlot`
 */
export function loadReference(index: /* u32 */ number): /* u32 */ number {
  'use gpu';
  const pair = pageSlot.$.loadReference(gridCoordinate(index >>> d.u32(1), pageSlot.$.referenceWidth)).x;
  return slugReferenceFromPair(pair, index);
}

/**
 * @note Uses `pageSlot`
 */
export function loadCurve(texelIndex: /* u32 */ number): SlugShaderCurve {
  'use gpu';
  const first = pageSlot.$.loadCurve(gridCoordinate(texelIndex, pageSlot.$.curveWidth));
  const second = pageSlot.$.loadCurve(gridCoordinate(texelIndex + 1, pageSlot.$.curveWidth));

  return SlugShaderCurve({
    p0: d.vec2f(first.x, first.y),
    p1: d.vec2f(first.z, first.w),
    p2: d.vec2f(second.x, second.y),
  });
}
