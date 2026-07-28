import type { DataTexture, Node } from 'three/webgpu'
import { float, int, ivec2, min, textureLoad, uint, vec2 } from 'three/tsl'
import {
  intDiv,
  intMod,
  loadUvec4,
  uintAdd,
  uintBitAnd,
  uintMul,
  uintShiftRight,
  unpackHalf2x16,
} from './tsl-compat.js'

const HEADER_REFERENCE_MASK = 0xffff
const HEADER_COUNT_SHIFT = 16

/** Maximum curves one fragment may evaluate from a hostile artifact. */
export const MAX_SAFE_SLUG_BAND_CURVES = 512

export interface SlugShaderPage {
  readonly curveTexture: DataTexture
  readonly curveWidth: number
  readonly headerTexture: DataTexture
  readonly headerWidth: number
  readonly referenceTexture: DataTexture
  readonly referenceWidth: number
  /** Build-time shader variant; the public V0 artifact always uses `plain-r16ui`. */
  readonly referenceFormat: 'plain-r16ui' | 'packed-hull-r32ui'
}

export interface SlugShaderCurve {
  readonly p0: Node<'vec2'>
  readonly p1: Node<'vec2'>
  readonly p2: Node<'vec2'>
}

export interface SlugShaderReference {
  readonly curve: Node<'uint'>
  /** Exact binary16 axis hull for the non-shipping packed-hull experiment. */
  readonly hull?: Node<'float'>
}

function gridCoordinate(index: Node<'uint'>, width: number): Node<'ivec2'> {
  const integerIndex: Node<'int'> = int(index)
  const integerWidth: Node<'int'> = int(width)
  return ivec2(intMod(integerIndex, integerWidth), intDiv(integerIndex, integerWidth))
}

function namedUint(node: Node<'uint'>, name: string): Node<'uint'> {
  return node.toVar(name)
}

export function loadHeader(
  page: SlugShaderPage,
  index: Node<'uint'>,
  axis: 'horizontal' | 'vertical',
): Node<'uint'> {
  const texel: Node<'vec4'> = textureLoad(
    page.headerTexture,
    gridCoordinate(index, page.headerWidth),
  )
  return namedUint(
    uint(texel.x),
    axis === 'horizontal' ? 'slugHorizontalHeader' : 'slugVerticalHeader',
  )
}

export function loadReference(
  page: SlugShaderPage,
  index: Node<'uint'>,
  axis: 'horizontal' | 'vertical',
): SlugShaderReference {
  if (page.referenceFormat === 'packed-hull-r32ui') {
    const packed = namedUint(
      loadUvec4(page.referenceTexture, gridCoordinate(index, page.referenceWidth)).x,
      axis === 'horizontal' ? 'slugHorizontalPackedReference' : 'slugVerticalPackedReference',
    )
    return {
      curve: namedUint(
        uintBitAnd(packed, uint(HEADER_REFERENCE_MASK)),
        axis === 'horizontal' ? 'slugHorizontalReference' : 'slugVerticalReference',
      ),
      hull: unpackHalf2x16(packed).y.toVar(
        axis === 'horizontal' ? 'slugHorizontalHull' : 'slugVerticalHull',
      ),
    }
  }
  const texel = loadUvec4(
    page.referenceTexture,
    gridCoordinate(uintShiftRight(index, uint(1)), page.referenceWidth),
  )
  const bitOffset = uintMul(uintBitAnd(index, uint(1)), uint(16))
  return {
    curve: namedUint(
      uintBitAnd(uintShiftRight(texel.x, bitOffset), uint(HEADER_REFERENCE_MASK)),
      axis === 'horizontal' ? 'slugHorizontalReference' : 'slugVerticalReference',
    ),
  }
}

export function loadCurve(page: SlugShaderPage, texelIndex: Node<'uint'>): SlugShaderCurve {
  const first: Node<'vec4'> = textureLoad(
    page.curveTexture,
    gridCoordinate(texelIndex, page.curveWidth),
  )
  const second: Node<'vec4'> = textureLoad(
    page.curveTexture,
    gridCoordinate(uintAdd(texelIndex, uint(1)), page.curveWidth),
  )
  return {
    p0: vec2(first.x, first.y),
    p1: vec2(first.z, first.w),
    p2: vec2(second.x, second.y),
  }
}

export function bandCount(header: Node<'uint'>): Node<'uint'> {
  return uint(
    min(float(uintShiftRight(header, uint(HEADER_COUNT_SHIFT))), MAX_SAFE_SLUG_BAND_CURVES),
  )
}

export function bandReferenceOffset(header: Node<'uint'>): Node<'uint'> {
  return uintBitAnd(header, uint(HEADER_REFERENCE_MASK))
}
