import * as TSL from 'three/tsl';
import type { Node } from 'three/webgpu';

// @types/three 0.185 erases this Fn's vec3 layout; the installed runtime declares vec3 -> vec3.
const srgbTransferEotf = TSL.sRGBTransferEOTF as unknown as (color: Node<'vec3'>) => Node<'vec3'>;

export function unpackSrgbRgba(value: Node<'uint'>): Node<'vec4'> {
  const byte = TSL.float(1 / 255);
  const color = srgbTransferEotf(
    TSL.vec3(
      TSL.float(value.bitAnd(TSL.uint(0xff))).mul(byte),
      TSL.float(value.shiftRight(TSL.uint(8)).bitAnd(TSL.uint(0xff))).mul(byte),
      TSL.float(value.shiftRight(TSL.uint(16)).bitAnd(TSL.uint(0xff))).mul(byte),
    ),
  );
  const alpha = TSL.float(value.shiftRight(TSL.uint(24)).bitAnd(TSL.uint(0xff))).mul(byte);
  return TSL.vec4(color, alpha);
}
