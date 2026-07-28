import { Loop, add, float, modelViewProjection, mul } from 'three/tsl'
import type { Node } from 'three/webgpu'

declare const left: Node<'float'>
declare const right: Node<'float'>

const sum: Node<'float'> = add(left, right)
const product: Node<'float'> = mul(left, right)
const scaled: Node<'float'> = mul(float(0.5), 2)
const clipPosition: Node<'vec4'> = modelViewProjection
const loop = Loop({ start: 0, end: 4, type: 'int' }, ({ i }) => {
  const index: Node<'int'> = i
  void index
})

void sum
void product
void scaled
void clipPosition
void loop
