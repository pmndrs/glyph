import * as TSL from 'three/tsl';
import type { Node } from 'three/webgpu';

import { unpackSrgbRgba } from './packed-color.js';

export interface TslDecorationInstanceNodes {
  /** Decoration rectangle: inline start, block start, inline extent, block extent. */
  readonly rect: Node<'vec4'>;
  /** Packed decoration lanes: x carries little-endian RGBA color, y carries flags and line style. */
  readonly packed: Node<'uvec2'>;
}

export interface TslDecorationShaderOutput {
  readonly position: Node<'vec3'>;
  readonly color: Node<'vec3'>;
  readonly opacity: Node<'float'>;
}

/** `packed` is sRGB-encoded, matching the Rust gather's decode table — color passes through the sRGB EOTF into linear space, but alpha stays linear. `positionLocal` spans `[0, 1]` like the glyph raster programs. */
export function decorationShader(instance: TslDecorationInstanceNodes): TslDecorationShaderOutput {
  const color = unpackSrgbRgba(instance.packed.x);
  return {
    position: TSL.vec3(
      instance.rect.x.add(TSL.positionLocal.x.mul(instance.rect.z)),
      instance.rect.y.add(TSL.positionLocal.y.mul(instance.rect.w)).negate(),
      0,
    ),
    color: color.rgb,
    opacity: color.a,
  };
}
