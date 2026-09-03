import * as TSL from 'three/tsl';
import type { Node } from 'three/webgpu';

export function unpackSrgbRgba(value: Node<'uint'>): Node<'vec4'> {
  const byte = TSL.float(1 / 255);
  const encoded = TSL.vec3(
    TSL.float(value.bitAnd(TSL.uint(0xff))).mul(byte),
    TSL.float(value.shiftRight(TSL.uint(8)).bitAnd(TSL.uint(0xff))).mul(byte),
    TSL.float(value.shiftRight(TSL.uint(16)).bitAnd(TSL.uint(0xff))).mul(byte),
  );
  const decodeChannel = (channel: Node<'float'>): Node<'float'> =>
    TSL.select(
      channel.lessThanEqual(0.04045),
      channel.mul(0.0773993808),
      channel.mul(0.9478672986).add(0.0521327014).pow(2.4),
    );
  const color = TSL.vec3(decodeChannel(encoded.x), decodeChannel(encoded.y), decodeChannel(encoded.z));
  const alpha = TSL.float(value.shiftRight(TSL.uint(24)).bitAnd(TSL.uint(0xff))).mul(byte);
  return TSL.vec4(color, alpha);
}
