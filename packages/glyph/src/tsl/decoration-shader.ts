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

/**
 * Builds the canonical decoration node graph: a solid quad covering the record's
 * rectangle, colored by the packed decoration paint. The graph reads `positionLocal`
 * from the technique's unit quad spanning `[0, 1]` with the origin at the upper-left
 * corner, matching the glyph techniques. Only solid lines reach this graph: the public
 * boundary rejects other line styles, and `packed.y` retains the style bits for the
 * later patterned-paint implementation.
 *
 * The packed bytes are sRGB-encoded — the same wire encoding whose glyph counterpart
 * the Rust gather decodes through its sRGB-to-linear table — so the color channels pass
 * through the sRGB EOTF into the renderer's linear working space. Alpha stays linear.
 */
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
