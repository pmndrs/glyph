/**
 * Resource-polymorphic access for a Slug page: the R32UI band-header grid and the RGBA32UI band-curve grid, one texel
 * per band entry holding the curve's control points as `pack2x16float` words `[p0, p1, p2, 0]`.
 *
 * Only the addressing that exists because these resources are 2D textures lives
 * here; the header bit layout belongs to the host-agnostic core.
 */
import tgpu, { d, std, type TgpuAccessor, type TgpuSlot } from 'typegpu';

export interface SlugShaderPage {
  readonly loadHeader: (coords: d.v2i) => d.v4u;
  readonly headerWidth: number;
  readonly loadBandCurve: (coords: d.v2i) => d.v4u;
  readonly bandCurveWidth: number;
}

export const slugHeaderWidthAccessor: TgpuAccessor<d.U32> = /* @__PURE__ */ tgpu.accessor(d.u32);
export const slugBandCurveWidthAccessor: TgpuAccessor<d.U32> = /* @__PURE__ */ tgpu.accessor(d.u32);
export const slugHeaderTexelSlot: TgpuSlot<SlugShaderPage['loadHeader']> =
  /* @__PURE__ */ tgpu.slot<SlugShaderPage['loadHeader']>();
export const slugBandCurveTexelSlot: TgpuSlot<SlugShaderPage['loadBandCurve']> =
  /* @__PURE__ */ tgpu.slot<SlugShaderPage['loadBandCurve']>();

export const SlugShaderCurve: d.WgslStruct<{ p0: d.Vec2f; p1: d.Vec2f; p2: d.Vec2f }> = /* @__PURE__ */ d.struct({
  p0: d.vec2f,
  p1: d.vec2f,
  p2: d.vec2f,
});
export type SlugShaderCurve = d.InferGPU<typeof SlugShaderCurve>;

/** Unsigned division by the row width, which compiles to a shift and a mask when the width is a power of two. */
function gridCoordinate(index: /* u32 */ number, width: /* u32 */ number): d.v2i {
  'use gpu';
  return d.vec2i(d.i32(index % width), d.i32(index / width));
}

/** Uses the configured header loader and width accessor. */
export function loadHeader(index: /* u32 */ number): /* u32 */ number {
  'use gpu';
  const texel = slugHeaderTexelSlot.$(gridCoordinate(index, slugHeaderWidthAccessor.$));
  return d.u32(texel.x);
}

/**
 * One IEEE half from its 16 bits, by arithmetic: `unpack2x16float` has no GLSL ES spelling the Three host's WebGL2
 * translation accepts. Exact for every finite half; the baker emits no infinities or NaNs.
 */
function halfToFloat(bits: /* u32 */ number): /* f32 */ number {
  'use gpu';
  const exponent = (bits >> d.u32(10)) & d.u32(31);
  const mantissa = d.f32(bits & d.u32(1023));
  const sign = std.select(d.f32(1), d.f32(-1), (bits & d.u32(0x8000)) !== d.u32(0));
  const normal = (1 + mantissa / 1024) * std.exp2(d.f32(exponent) - 15);
  return sign * std.select(normal, mantissa * std.exp2(d.f32(-24)), exponent === d.u32(0));
}

function unpackHalves(word: /* u32 */ number): d.v2f {
  'use gpu';
  return d.vec2f(halfToFloat(word & d.u32(0xffff)), halfToFloat(word >> d.u32(16)));
}

/**
 * How a `pack2x16float` word becomes two floats. Defaults to the portable arithmetic decode; a WebGPU-only host binds
 * `std.unpack2x16float`.
 */
export const slugUnpackHalvesSlot: TgpuSlot<(word: number) => d.v2f> =
  /* @__PURE__ */ tgpu.slot<(word: number) => d.v2f>(unpackHalves);

/** One band entry's curve, in one load. Uses the configured band-curve loader and width accessor. */
export function loadBandCurve(entry: /* u32 */ number): SlugShaderCurve {
  'use gpu';
  const texel = slugBandCurveTexelSlot.$(gridCoordinate(entry, slugBandCurveWidthAccessor.$));
  return SlugShaderCurve({
    p0: slugUnpackHalvesSlot.$(texel.x),
    p1: slugUnpackHalvesSlot.$(texel.y),
    p2: slugUnpackHalvesSlot.$(texel.z),
  });
}
