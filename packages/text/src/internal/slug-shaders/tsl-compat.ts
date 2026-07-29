import type { DataTexture, Node } from 'three/webgpu'
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
} from 'three/tsl'

/**
 * TypeScript 7.0.2 pathologically expands selected Three 0.185.1 overloads
 * when augmented nodes reach a non-leading overload. Keep the public runtime
 * functions and deliberate callable erasure inside this one version-pinned
 * boundary; every caller retains one exact node signature.
 */
const addRuntime: Function = addOperator
const bitAndRuntime: Function = bitAndOperator
const bitOrRuntime: Function = bitOrOperator
const divRuntime: Function = divOperator
const fwidthRuntime: Function = fwidthOperator
const lessThanRuntime: Function = lessThanOperator
const loopRuntime: Function = loopOperator
const modRuntime: Function = modOperator
const mulRuntime: Function = mulOperator
const shiftLeftRuntime: Function = shiftLeftOperator
const shiftRightRuntime: Function = shiftRightOperator
const subRuntime: Function = subOperator
const textureLoadRuntime: Function = textureLoadOperator
const uintRuntime: Function = uintOperator

function callIntBinary(operator: Function, left: Node<'int'>, right: Node<'int'>): Node<'int'> {
  return Reflect.apply(operator, undefined, [left, right]) as Node<'int'>
}

function callUintBinary(operator: Function, left: Node<'uint'>, right: Node<'uint'>): Node<'uint'> {
  return Reflect.apply(operator, undefined, [left, right]) as Node<'uint'>
}

export function intDiv(left: Node<'int'>, right: Node<'int'>): Node<'int'> {
  return callIntBinary(divRuntime, left, right)
}

export function intMod(left: Node<'int'>, right: Node<'int'>): Node<'int'> {
  return callIntBinary(modRuntime, left, right)
}

export function intLessThan(left: Node<'int'>, right: Node<'int'>): Node<'bool'> {
  return Reflect.apply(lessThanRuntime, undefined, [left, right]) as Node<'bool'>
}

export function whileLoop(condition: Node<'bool'>, body: () => void): Node<'void'> {
  return Reflect.apply(loopRuntime, undefined, [condition, body]) as Node<'void'>
}

export function loadUvec4(texture: DataTexture, coordinate: Node<'ivec2'>): Node<'uvec4'> {
  return Reflect.apply(textureLoadRuntime, undefined, [texture, coordinate]) as Node<'uvec4'>
}

export function uintAdd(left: Node<'uint'>, right: Node<'uint'>): Node<'uint'> {
  return callUintBinary(addRuntime, left, right)
}

export function uintFromInt(value: Node<'int'>): Node<'uint'> {
  return Reflect.apply(uintRuntime, undefined, [value]) as Node<'uint'>
}

export function uintBitAnd(left: Node<'uint'>, right: Node<'uint'>): Node<'uint'> {
  return callUintBinary(bitAndRuntime, left, right)
}

export function uintBitOr(left: Node<'uint'>, right: Node<'uint'>): Node<'uint'> {
  return callUintBinary(bitOrRuntime, left, right)
}

export function uintMul(left: Node<'uint'>, right: Node<'uint'>): Node<'uint'> {
  return callUintBinary(mulRuntime, left, right)
}

export function uintShiftLeft(left: Node<'uint'>, right: Node<'uint'>): Node<'uint'> {
  return callUintBinary(shiftLeftRuntime, left, right)
}

export function uintShiftRight(left: Node<'uint'>, right: Node<'uint'>): Node<'uint'> {
  return callUintBinary(shiftRightRuntime, left, right)
}

export function vec2Fwidth(value: Node<'vec2'>): Node<'vec2'> {
  return Reflect.apply(fwidthRuntime, undefined, [value]) as Node<'vec2'>
}

export function vec2Sub(left: Node<'vec2'>, right: Node<'vec2'>): Node<'vec2'> {
  return Reflect.apply(subRuntime, undefined, [left, right]) as Node<'vec2'>
}
