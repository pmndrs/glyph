import * as TSL from 'three/tsl';
import type { Node } from 'three/webgpu';

import type { TslSlugInstanceNodes, TslSlugShaderResources } from '../shader.js';
import type { slugDilate, slugDilateMatrix } from '../slug-dilate.js';

/** Where one corner of the technique's `[0, 1]` unit quad (origin upper-left) lands for a glyph. */
interface SlugQuadVertex {
  /** Paragraph-local position with y measured upward, as the dilation and projection expect. */
  readonly localPosition: Node<'vec2'>;
  /** Offset from the quad centre; dilation pushes the corner along it by half a pixel. */
  readonly outwardNormal: Node<'vec2'>;
  /** Em-space coordinate the coverage integral is evaluated at before dilation. */
  readonly emCoordinate: Node<'vec2'>;
}

/** The half-pixel dilation a Slug graph applies; the TSL graph and the TypeGPU-backed graph each bring their own. */
export interface SlugDilation {
  readonly slugDilate: typeof slugDilate;
  readonly slugDilateMatrix: typeof slugDilateMatrix;
}

/**
 * The vertex half of a Slug graph: maps `positionLocal` on the unit quad onto the glyph, dilates it by half a pixel
 * with the per-glyph MVP rows or matrix, writes the em-space `renderCoordinate` varying, and returns the position.
 * Call inside `TSL.Fn`.
 */
export function slugVertexPosition(
  instance: TslSlugInstanceNodes,
  resources: TslSlugShaderResources,
  renderCoordinate: ReturnType<typeof TSL.varyingProperty>,
  dilation: SlugDilation,
): Node<'vec3'> {
  const { localPosition, outwardNormal, emCoordinate } = slugQuadVertex(instance);
  const dilated =
    resources.modelViewProjection === undefined
      ? dilation.slugDilate(
          localPosition,
          outwardNormal,
          emCoordinate,
          instance.inverseScale,
          resources.modelViewProjectionRow0,
          resources.modelViewProjectionRow1,
          resources.modelViewProjectionRow3,
          resources.viewport,
        )
      : dilation.slugDilateMatrix(
          localPosition,
          outwardNormal,
          emCoordinate,
          instance.inverseScale,
          resources.modelViewProjection,
          resources.viewport,
        );
  renderCoordinate.assign(dilated.textureCoordinate);
  return TSL.vec3(dilated.position.x, dilated.position.y, 0);
}

function slugQuadVertex(
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
