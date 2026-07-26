import { add, float, mul } from 'three/tsl'
import type Node from 'three/src/nodes/core/Node.js'

declare const left: Node<'float'>
declare const right: Node<'float'>

const sum: Node<'float'> = add(left, right)
const product: Node<'float'> = mul(left, right)
const scaled: Node<'float'> = mul(float(0.5), 2)

void sum
void product
void scaled
