import type { DataTexture, Node } from 'three/webgpu';
import {
  Loop as loopOperator,
  add as addOperator,
  bitAnd as bitAndOperator,
  bitOr as bitOrOperator,
  div as divOperator,
  fwidth as fwidthOperator,
  lessThan as lessThanOperator,
  mod as modOperator,
  mul as mulOperator,
  shiftLeft as shiftLeftOperator,
  shiftRight as shiftRightOperator,
  sub as subOperator,
  textureLoad as textureLoadOperator,
  uint as uintOperator,
} from 'three/tsl';

/** Three 0.185.1 omits the runtime while-loop overload and unsigned texture result type. */
const loopRuntime: Function = loopOperator;
const textureLoadRuntime: Function = textureLoadOperator;

export function intDiv(left: Node<'int'>, right: Node<'int'>): Node<'int'> {
  return divOperator(left, right);
}

export function intMod(left: Node<'int'>, right: Node<'int'>): Node<'int'> {
  return modOperator(left, right);
}

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

export function uintFromInt(value: Node<'int'>): Node<'uint'> {
  return uintOperator(value);
}

export function uintBitAnd(left: Node<'uint'>, right: Node<'uint'>): Node<'uint'> {
  return bitAndOperator(left, right);
}

export function uintBitOr(left: Node<'uint'>, right: Node<'uint'>): Node<'uint'> {
  return bitOrOperator(left, right);
}

export function uintMul(left: Node<'uint'>, right: Node<'uint'>): Node<'uint'> {
  return mulOperator(left, right);
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
