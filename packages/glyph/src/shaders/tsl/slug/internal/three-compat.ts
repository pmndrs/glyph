import type { DataTexture, Node } from 'three/webgpu';
import {
  Loop as loopOperator,
  add as addOperator,
  bitAnd as bitAndOperator,
  bitOr as bitOrOperator,
  fwidth as fwidthOperator,
  lessThan as lessThanOperator,
  shiftLeft as shiftLeftOperator,
  shiftRight as shiftRightOperator,
  sub as subOperator,
  textureLoad as textureLoadOperator,
} from 'three/tsl';

/** Three 0.185.1 omits the runtime while-loop overload and unsigned texture result type. */
const loopRuntime: Function = loopOperator;
const textureLoadRuntime: Function = textureLoadOperator;

export function intLessThan(left: Node<'int'>, right: Node<'int'>): Node<'bool'> {
  return lessThanOperator(left, right);
}

export function whileLoop(condition: Node<'bool'>, body: () => void): Node<'void'> {
  return Reflect.apply(loopRuntime, undefined, [condition, body]) as Node<'void'>;
}

export function loadUvec4(texture: DataTexture, coordinate: Node<'ivec2'>): Node<'uvec4'> {
  return Reflect.apply(textureLoadRuntime, undefined, [texture, coordinate]) as Node<'uvec4'>;
}

export function uintAdd(left: Node<'uint'>, right: Node<'uint'>): Node<'uint'> {
  return addOperator(left, right);
}

export function uintBitAnd(left: Node<'uint'>, right: Node<'uint'>): Node<'uint'> {
  return bitAndOperator(left, right);
}

export function uintBitOr(left: Node<'uint'>, right: Node<'uint'>): Node<'uint'> {
  return bitOrOperator(left, right);
}

export function uintShiftLeft(left: Node<'uint'>, right: Node<'uint'>): Node<'uint'> {
  return shiftLeftOperator(left, right);
}

export function uintShiftRight(left: Node<'uint'>, right: Node<'uint'>): Node<'uint'> {
  return shiftRightOperator(left, right);
}

export function vec2Fwidth(value: Node<'vec2'>): Node<'vec2'> {
  return fwidthOperator(value);
}

export function vec2Sub(left: Node<'vec2'>, right: Node<'vec2'>): Node<'vec2'> {
  return subOperator(left, right);
}
