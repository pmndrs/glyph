/**
 * Three.js/TSL resource access for PMNDRS_font_slug V0's exact R32UI header grid,
 * R16UI glyph-local reference grid, and RGBA16F curve grid.
 *
 * Only the addressing that exists because these resources are 2D textures lives
 * here; the header and reference bit layout belongs to the host-agnostic core.
 */
import type { DataTexture, Node } from 'three/webgpu';
import { int, ivec2, textureLoad, uint, vec2 } from 'three/tsl';
import { d } from 'typegpu';
import * as t3 from '@typegpu/three';
import { coreValue } from './core-boundary.js';
import { slugReferenceFromPair } from './core/band.js';
import { intDiv, intMod, loadUvec4, uintAdd, uintShiftRight } from './tsl-compat.js';

export interface SlugShaderPage {
  readonly curveTexture: DataTexture;
  readonly curveWidth: number;
  readonly headerTexture: DataTexture;
  readonly headerWidth: number;
  readonly referenceTexture: DataTexture;
  readonly referenceWidth: number;
}

export interface SlugShaderCurve {
  readonly p0: Node<'vec2'>;
  readonly p1: Node<'vec2'>;
  readonly p2: Node<'vec2'>;
}

function gridCoordinate(index: Node<'uint'>, width: number): Node<'ivec2'> {
  const integerIndex: Node<'int'> = int(index);
  const integerWidth: Node<'int'> = int(width);
  return ivec2(intMod(integerIndex, integerWidth), intDiv(integerIndex, integerWidth));
}

export function loadHeader(
  page: SlugShaderPage,
  index: Node<'uint'>,
  axis: 'horizontal' | 'vertical',
  namePrefix: string = axis === 'horizontal' ? 'slugHorizontal' : 'slugVertical',
): Node<'uint'> {
  const texel: Node<'vec4'> = textureLoad(page.headerTexture, gridCoordinate(index, page.headerWidth));
  return uint(texel.x).toVar(`${namePrefix}Header`);
}

export function loadReference(
  page: SlugShaderPage,
  index: Node<'uint'>,
  axis: 'horizontal' | 'vertical',
  namePrefix: string = axis === 'horizontal' ? 'slugHorizontal' : 'slugVertical',
): Node<'uint'> {
  const pair = loadUvec4(page.referenceTexture, gridCoordinate(uintShiftRight(index, uint(1)), page.referenceWidth)).x;
  return coreValue('uint', `${namePrefix}Reference`, () => {
    'use gpu';
    return slugReferenceFromPair(t3.fromTSL(pair, d.u32).$, t3.fromTSL(index, d.u32).$);
  });
}

export function loadCurve(page: SlugShaderPage, texelIndex: Node<'uint'>): SlugShaderCurve {
  const first: Node<'vec4'> = textureLoad(page.curveTexture, gridCoordinate(texelIndex, page.curveWidth));
  const second: Node<'vec4'> = textureLoad(
    page.curveTexture,
    gridCoordinate(uintAdd(texelIndex, uint(1)), page.curveWidth),
  );
  return {
    p0: vec2(first.x, first.y),
    p1: vec2(first.z, first.w),
    p2: vec2(second.x, second.y),
  };
}
