import {
  Loop,
  add,
  bitAnd,
  div,
  float,
  fwidth,
  int,
  modelViewProjection,
  mod,
  mul,
  shiftLeft,
  uint,
  vec2,
} from 'three/tsl';
import type { Node } from 'three/webgpu';

declare const left: Node<'float'>;
declare const right: Node<'float'>;

const sum: Node<'float'> = add(left, right);
const product: Node<'float'> = mul(left, right);
const scaled: Node<'float'> = mul(float(0.5), 2);
const clipPosition: Node<'vec4'> = modelViewProjection;
const chainedProduct: Node<'float'> = left.mul(right);

const uintLeft: Node<'uint'> = uint(1);
const uintRight: Node<'uint'> = uint(2);
const shifted: Node<'uint'> = shiftLeft(uintLeft, uintRight);
const masked: Node<'uint'> = bitAnd(shifted, uint(0xff));
const integerQuotient: Node<'int'> = div(int(8), int(2));
const integerRemainder: Node<'int'> = mod(int(9), int(2));
const vectorWidth: Node<'vec2'> = fwidth(vec2(left, right));
const loop = Loop({ type: 'uint', start: uint(0), end: uint(4), condition: '<' }, ({ i }) => {
  const index: Node<'uint'> = i;
  void index;
});

void sum;
void product;
void scaled;
void clipPosition;
void chainedProduct;
void shifted;
void masked;
void integerQuotient;
void integerRemainder;
void vectorWidth;
void loop;
