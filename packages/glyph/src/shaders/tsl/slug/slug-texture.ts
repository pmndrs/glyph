import type { DataTexture, Node } from 'three/webgpu';
import { float, int, ivec2, min, textureLoad, uint, unpackHalf2x16 } from 'three/tsl';
import { loadUvec4, uintBitAnd, uintShiftRight } from './internal/three-compat.js';

const HEADER_REFERENCE_MASK = 0xffff;
const HEADER_COUNT_SHIFT = 16;

/** Maximum curves one fragment may evaluate from a hostile artifact. */
export const MAX_SAFE_SLUG_BAND_CURVES = 512;

export interface SlugShaderPage {
  readonly headerTexture: DataTexture;
  readonly headerWidth: number;
  /** One `rgba32uint` texel per band entry: the curve's control points as `pack2x16float` words `[p0, p1, p2, 0]`. */
  readonly bandCurveTexture: DataTexture;
  readonly bandCurveWidth: number;
}

export interface SlugShaderCurve {
  readonly p0: Node<'vec2'>;
  readonly p1: Node<'vec2'>;
  readonly p2: Node<'vec2'>;
}

/** Unsigned division by a literal width, which compiles to a shift and a mask when the width is a power of two. */
function gridCoordinate(index: Node<'uint'>, width: number): Node<'ivec2'> {
  return ivec2(int(index.mod(uint(width))), int(index.div(uint(width))));
}

function namedUint(node: Node<'uint'>, name: string): Node<'uint'> {
  return node.toVar(name);
}

export function loadHeader(
  page: SlugShaderPage,
  index: Node<'uint'>,
  axis: 'horizontal' | 'vertical',
  namePrefix: string = axis === 'horizontal' ? 'slugHorizontal' : 'slugVertical',
): Node<'uint'> {
  const texel: Node<'vec4'> = textureLoad(page.headerTexture, gridCoordinate(index, page.headerWidth));
  return namedUint(uint(texel.x), `${namePrefix}Header`);
}

/** One band entry's curve, in one load. */
export function loadBandCurve(page: SlugShaderPage, entry: Node<'uint'>): SlugShaderCurve {
  const texel = loadUvec4(page.bandCurveTexture, gridCoordinate(entry, page.bandCurveWidth));
  const half = (word: Node<'uint'>) => unpackHalf2x16(word) as unknown as Node<'vec2'>;
  return { p0: half(texel.x), p1: half(texel.y), p2: half(texel.z) };
}

export function bandCount(header: Node<'uint'>): Node<'uint'> {
  return uint(min(float(uintShiftRight(header, uint(HEADER_COUNT_SHIFT))), MAX_SAFE_SLUG_BAND_CURVES));
}

export function bandReferenceOffset(header: Node<'uint'>): Node<'uint'> {
  return uintBitAnd(header, uint(HEADER_REFERENCE_MASK));
}
