import * as TSL from 'three/tsl';
import type { Node } from 'three/webgpu';

import type { TslSlugInstanceNodes } from '../shader.js';

/** Where one corner of the technique's `[0, 1]` unit quad (origin upper-left) lands for a glyph. */
export interface SlugQuadVertex {
  /** Paragraph-local position with y measured upward, as the dilation and projection expect. */
  readonly localPosition: Node<'vec2'>;
  /** Offset from the quad centre; dilation pushes the corner along it by half a pixel. */
  readonly outwardNormal: Node<'vec2'>;
  /** Em-space coordinate the coverage integral is evaluated at before dilation. */
  readonly emCoordinate: Node<'vec2'>;
}

/** Maps `positionLocal` on the unit quad onto one glyph; shared by the TSL and TypeGPU-backed Slug graphs. */
export function slugQuadVertex(
  instance: Pick<TslSlugInstanceNodes, 'origin' | 'size' | 'emOrigin' | 'emSize'>,
): SlugQuadVertex {
  return {
    localPosition: TSL.vec2(
      instance.origin.x.add(TSL.positionLocal.x.mul(instance.size.x)),
      instance.origin.y.add(TSL.positionLocal.y.mul(instance.size.y)).negate(),
    ),
    outwardNormal: TSL.vec2(
      TSL.positionLocal.x.sub(0.5).mul(instance.size.x),
      TSL.positionLocal.y.sub(0.5).mul(instance.size.y).negate(),
    ),
    emCoordinate: TSL.vec2(
      instance.emOrigin.x.add(TSL.positionLocal.x.mul(instance.emSize.x)),
      instance.emOrigin.y.sub(TSL.positionLocal.y.mul(instance.emSize.y)),
    ),
  };
}
