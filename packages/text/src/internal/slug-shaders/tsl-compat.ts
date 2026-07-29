import type { DataTexture, Node } from 'three/webgpu'
import {
  Loop as loopOperator,
  abs as absOperator,
  add as addOperator,
  and as andOperator,
  bitAnd as bitAndOperator,
  bitOr as bitOrOperator,
  clamp as clampOperator,
  div as divOperator,
  dot as dotOperator,
  float as floatOperator,
  fwidth as fwidthOperator,
  greaterThan as greaterThanOperator,
  int as intOperator,
  lessThan as lessThanOperator,
  lessThanEqual as lessThanEqualOperator,
  max as maxOperator,
  min as minOperator,
  mod as modOperator,
  mul as mulOperator,
  select as selectOperator,
  shiftLeft as shiftLeftOperator,
  shiftRight as shiftRightOperator,
  smoothstep as smoothstepOperator,
  sqrt as sqrtOperator,
  sub as subOperator,
  textureLoad as textureLoadOperator,
  uint as uintOperator,
  vec2 as vec2Operator,
  vec4 as vec4Operator,
} from 'three/tsl'

/**
 * TypeScript 7.0.2 pathologically expands selected Three 0.185.1 overloads
 * when augmented nodes reach a non-leading overload. Keep the public runtime
 * functions and deliberate callable erasure inside this one version-pinned
 * boundary; every caller retains one exact node signature.
 */
const addRuntime: Function = addOperator
const andRuntime: Function = andOperator
const absRuntime: Function = absOperator
const bitAndRuntime: Function = bitAndOperator
const bitOrRuntime: Function = bitOrOperator
const clampRuntime: Function = clampOperator
const divRuntime: Function = divOperator
const dotRuntime: Function = dotOperator
const floatRuntime: Function = floatOperator
const fwidthRuntime: Function = fwidthOperator
const greaterThanRuntime: Function = greaterThanOperator
const intRuntime: Function = intOperator
const lessThanRuntime: Function = lessThanOperator
const lessThanEqualRuntime: Function = lessThanEqualOperator
const loopRuntime: Function = loopOperator
const maxRuntime: Function = maxOperator
const minRuntime: Function = minOperator
const modRuntime: Function = modOperator
const mulRuntime: Function = mulOperator
const selectRuntime: Function = selectOperator
const shiftLeftRuntime: Function = shiftLeftOperator
const shiftRightRuntime: Function = shiftRightOperator
const smoothstepRuntime: Function = smoothstepOperator
const sqrtRuntime: Function = sqrtOperator
const subRuntime: Function = subOperator
const textureLoadRuntime: Function = textureLoadOperator
const uintRuntime: Function = uintOperator
const vec2Runtime: Function = vec2Operator
const vec4Runtime: Function = vec4Operator

function callFloatUnary(operator: Function, value: Node<'float'>): Node<'float'> {
  return Reflect.apply(operator, undefined, [value]) as Node<'float'>
}

function callFloatBinary(
  operator: Function,
  left: Node<'float'>,
  right: Node<'float'>,
): Node<'float'> {
  return Reflect.apply(operator, undefined, [left, right]) as Node<'float'>
}

function callFloatComparison(
  operator: Function,
  left: Node<'float'>,
  right: Node<'float'>,
): Node<'bool'> {
  return Reflect.apply(operator, undefined, [left, right]) as Node<'bool'>
}

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

export function floatAbs(value: Node<'float'>): Node<'float'> {
  return callFloatUnary(absRuntime, value)
}

export function floatAdd(left: Node<'float'>, right: Node<'float'>): Node<'float'> {
  return callFloatBinary(addRuntime, left, right)
}

export function floatClamp(
  value: Node<'float'>,
  minimum: Node<'float'>,
  maximum: Node<'float'>,
): Node<'float'> {
  return Reflect.apply(clampRuntime, undefined, [value, minimum, maximum]) as Node<'float'>
}

export function floatDiv(left: Node<'float'>, right: Node<'float'>): Node<'float'> {
  return callFloatBinary(divRuntime, left, right)
}

export function floatFromUint(value: Node<'uint'>): Node<'float'> {
  return Reflect.apply(floatRuntime, undefined, [value]) as Node<'float'>
}

export function floatLessThan(left: Node<'float'>, right: Node<'float'>): Node<'bool'> {
  return callFloatComparison(lessThanRuntime, left, right)
}

export function floatGreaterThan(left: Node<'float'>, right: Node<'float'>): Node<'bool'> {
  return callFloatComparison(greaterThanRuntime, left, right)
}

export function floatLessThanEqual(left: Node<'float'>, right: Node<'float'>): Node<'bool'> {
  return callFloatComparison(lessThanEqualRuntime, left, right)
}

export function floatMax(left: Node<'float'>, right: Node<'float'>): Node<'float'> {
  return callFloatBinary(maxRuntime, left, right)
}

export function floatMin(left: Node<'float'>, right: Node<'float'>): Node<'float'> {
  return callFloatBinary(minRuntime, left, right)
}

export function floatMul(left: Node<'float'>, right: Node<'float'>): Node<'float'> {
  return callFloatBinary(mulRuntime, left, right)
}

export function floatSelect(
  condition: Node<'bool'>,
  whenTrue: Node<'float'>,
  whenFalse: Node<'float'>,
): Node<'float'> {
  return Reflect.apply(selectRuntime, undefined, [condition, whenTrue, whenFalse]) as Node<'float'>
}

export function floatSqrt(value: Node<'float'>): Node<'float'> {
  return callFloatUnary(sqrtRuntime, value)
}

export function floatSmoothstep(
  edge0: Node<'float'>,
  edge1: Node<'float'>,
  value: Node<'float'>,
): Node<'float'> {
  return Reflect.apply(smoothstepRuntime, undefined, [edge0, edge1, value]) as Node<'float'>
}

export function floatSub(left: Node<'float'>, right: Node<'float'>): Node<'float'> {
  return callFloatBinary(subRuntime, left, right)
}

export function intLoop(
  bounds: {
    readonly start: Node<'int'> | number
    readonly end: Node<'int'> | number
    readonly type: 'int'
  },
  body: (inputs: { readonly i: Node<'int'> }) => void,
): Node<'void'> {
  return Reflect.apply(loopRuntime, undefined, [bounds, body]) as Node<'void'>
}

export function intLessThan(left: Node<'int'>, right: Node<'int'>): Node<'bool'> {
  return Reflect.apply(lessThanRuntime, undefined, [left, right]) as Node<'bool'>
}

export function whileLoop(condition: Node<'bool'>, body: () => void): Node<'void'> {
  return Reflect.apply(loopRuntime, undefined, [condition, body]) as Node<'void'>
}

export function intFromFloat(value: Node<'float'>): Node<'int'> {
  return Reflect.apply(intRuntime, undefined, [value]) as Node<'int'>
}

export function intFromUint(value: Node<'uint'>): Node<'int'> {
  return Reflect.apply(intRuntime, undefined, [value]) as Node<'int'>
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

export function vec2Add(left: Node<'vec2'>, right: Node<'vec2'>): Node<'vec2'> {
  return Reflect.apply(addRuntime, undefined, [left, right]) as Node<'vec2'>
}

export function vec2Dot(left: Node<'vec2'>, right: Node<'vec2'>): Node<'float'> {
  return Reflect.apply(dotRuntime, undefined, [left, right]) as Node<'float'>
}

export function vec2FromFloats(x: Node<'float'>, y: Node<'float'>): Node<'vec2'> {
  return Reflect.apply(vec2Runtime, undefined, [x, y]) as Node<'vec2'>
}

export function vec2MulFloat(value: Node<'vec2'>, scalar: Node<'float'>): Node<'vec2'> {
  return Reflect.apply(mulRuntime, undefined, [value, scalar]) as Node<'vec2'>
}

export function vec2Sub(left: Node<'vec2'>, right: Node<'vec2'>): Node<'vec2'> {
  return Reflect.apply(subRuntime, undefined, [left, right]) as Node<'vec2'>
}

export function boolAnd(left: Node<'bool'>, right: Node<'bool'>): Node<'bool'> {
  return Reflect.apply(andRuntime, undefined, [left, right]) as Node<'bool'>
}

export function vec3Add(left: Node<'vec3'>, right: Node<'vec3'>): Node<'vec3'> {
  return Reflect.apply(addRuntime, undefined, [left, right]) as Node<'vec3'>
}

export function vec3DivFloat(value: Node<'vec3'>, scalar: Node<'float'>): Node<'vec3'> {
  return Reflect.apply(divRuntime, undefined, [value, scalar]) as Node<'vec3'>
}

export function vec3MulFloat(value: Node<'vec3'>, scalar: Node<'float'>): Node<'vec3'> {
  return Reflect.apply(mulRuntime, undefined, [value, scalar]) as Node<'vec3'>
}

export function vec4FromVec3Float(value: Node<'vec3'>, scalar: Node<'float'>): Node<'vec4'> {
  return Reflect.apply(vec4Runtime, undefined, [value, scalar]) as Node<'vec4'>
}
