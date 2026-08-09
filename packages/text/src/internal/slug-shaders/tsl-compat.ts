import type { DataTexture, Node } from 'three/webgpu';
import {
  Loop as loopOperator,
  add as addOperator,
  div as divOperator,
  lessThan as lessThanOperator,
  mod as modOperator,
  shiftRight as shiftRightOperator,
  textureLoad as textureLoadOperator,
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

export function uintShiftRight(left: Node<'uint'>, right: Node<'uint'>): Node<'uint'> {
  return shiftRightOperator(left, right);
}
