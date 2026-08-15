import * as TSL from 'three/tsl';
import type { Node } from 'three/webgpu';

export interface ThreeDecorationInstanceNodes {
  /** Decoration rectangle: inline start, block start, inline extent, block extent. */
  readonly rect: Node<'vec4'>;
  /** Packed decoration lanes: x carries little-endian RGBA color, y carries flags and line style. */
  readonly packed: Node<'uvec2'>;
}

export interface ThreeDecorationShaderOutput {
  readonly position: Node<'vec3'>;
  readonly color: Node<'vec3'>;
  readonly opacity: Node<'float'>;
}

// @types/three 0.185 declares sRGBTransferEOTF as `(color: Node) => Node`, but the installed
// runtime Fn is laid out as vec3 -> vec3 (ColorSpaceFunctions `setLayout({ type: 'vec3', ... })`).
const srgbTransferEotf = TSL.sRGBTransferEOTF as unknown as (color: Node<'vec3'>) => Node<'vec3'>;

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
export function decorationShader(instance: ThreeDecorationInstanceNodes): ThreeDecorationShaderOutput {
  const byte = TSL.float(1 / 255);
  const color = srgbTransferEotf(
    TSL.vec3(
      TSL.float(instance.packed.x.bitAnd(TSL.uint(0xff))).mul(byte),
      TSL.float(instance.packed.x.shiftRight(TSL.uint(8)).bitAnd(TSL.uint(0xff))).mul(byte),
      TSL.float(instance.packed.x.shiftRight(TSL.uint(16)).bitAnd(TSL.uint(0xff))).mul(byte),
    ),
  );
  const alpha = TSL.float(instance.packed.x.shiftRight(TSL.uint(24)).bitAnd(TSL.uint(0xff))).mul(byte);
  return {
    position: TSL.vec3(
      instance.rect.x.add(TSL.positionLocal.x.mul(instance.rect.z)),
      instance.rect.y.add(TSL.positionLocal.y.mul(instance.rect.w)).negate(),
      0,
    ),
    color,
    opacity: alpha,
  };
}
