import * as TSL from 'three/tsl';
import type { Node, Texture } from 'three/webgpu';

/**
 * One glyph instance's canonical Bitmap fields, already resolved to nodes. Core owns what each field means; how a
 * program addresses it — storage buffers, instanced attributes, or a texture — stays the program's own choice.
 */
export interface ThreeBitmapInstanceNodes {
  /** Paragraph-local glyph origin, in layout units, with y measured downward. */
  readonly origin: Node<'vec2'>;
  /** Glyph quad extent in layout units. */
  readonly size: Node<'vec2'>;
  /** Upper-left atlas coordinate of the glyph's coverage rectangle. */
  readonly uvOrigin: Node<'vec2'>;
  /** Atlas extent of the glyph's coverage rectangle. */
  readonly uvSize: Node<'vec2'>;
  /** Resolved paint colour with alpha, unpremultiplied. */
  readonly color: Node<'vec4'>;
}

/** The GPU resources one Bitmap glyph batch binds: the single-channel coverage page its strike binding selected. */
export interface ThreeBitmapShaderResources {
  readonly page: Texture;
}

/** Everything the canonical Bitmap graph produces, so a program can consume a stage or compose over its final output. */
export interface ThreeBitmapShaderOutput {
  readonly position: Node<'vec3'>;
  /** Atlas coordinate the page is sampled at, with the vertical flip already applied. */
  readonly atlasUv: Node<'vec2'>;
  /** Sampled glyph coverage before paint alpha. */
  readonly coverage: Node<'float'>;
  readonly color: Node<'vec3'>;
  readonly opacity: Node<'float'>;
}

/**
 * Builds the canonical Bitmap node graph. This is the exact graph `ThreeBitmapTarget` renders, so a program that
 * composes over the returned nodes inherits the technique's coverage sampling instead of reimplementing it.
 *
 * The graph reads `positionLocal` and `uv()` from the technique's unit quad: both must span `[0, 1]` with the origin at
 * the glyph's upper-left corner. A program supplying different geometry owns that correspondence.
 */
export function bitmapShader(
  instance: ThreeBitmapInstanceNodes,
  resources: ThreeBitmapShaderResources,
): ThreeBitmapShaderOutput {
  const atlasUv = TSL.vec2(
    instance.uvOrigin.x.add(TSL.uv().x.mul(instance.uvSize.x)),
    TSL.float(1).sub(instance.uvOrigin.y.add(TSL.uv().y.mul(instance.uvSize.y))),
  );
  const coverage = TSL.texture(resources.page, atlasUv).r;
  return {
    position: TSL.vec3(
      instance.origin.x.add(TSL.positionLocal.x.mul(instance.size.x)),
      instance.origin.y.add(TSL.positionLocal.y.mul(instance.size.y)).negate(),
      0,
    ),
    atlasUv,
    coverage,
    color: instance.color.rgb,
    opacity: instance.color.a.mul(coverage),
  };
}
