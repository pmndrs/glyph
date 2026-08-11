import * as TSL from 'three/tsl';
import type { DataTexture, Node } from 'three/webgpu';

import { slugDilate, slugDilateMatrix, slugRender, type SlugRenderOptions } from './slug-shaders/index.js';

/**
 * One glyph instance's canonical Slug fields, already resolved to nodes. The address and count fields locate the
 * glyph's band tables inside the shared page; core owns their meaning, and a program owns how it stores them.
 */
export interface TslSlugInstanceNodes {
  /** Paragraph-local glyph origin, in layout units, with y measured downward. */
  readonly origin: Node<'vec2'>;
  /** Glyph quad extent in layout units. */
  readonly size: Node<'vec2'>;
  /** Upper-left em-space coordinate of the glyph quad. */
  readonly emOrigin: Node<'vec2'>;
  /** Em-space extent of the glyph quad. */
  readonly emSize: Node<'vec2'>;
  /** Layout units per em, used to carry the dilation back into em space. */
  readonly inverseScale: Node<'float'>;
  /** Resolved paint colour with alpha, unpremultiplied. */
  readonly color: Node<'vec4'>;
  /** Band grid placement as `(originX, originY, scaleX, scaleY)` in em space. */
  readonly bandTransform: Node<'vec4'>;
  readonly curveBaseTexel: Node<'uint'>;
  readonly horizontalHeaderBase: Node<'uint'>;
  readonly verticalHeaderBase: Node<'uint'>;
  readonly referenceBase: Node<'uint'>;
  readonly horizontalBandCount: Node<'uint'>;
  readonly verticalBandCount: Node<'uint'>;
}

/** The three integer textures one decoded Slug page publishes, plus the row widths that address them. */
export interface TslSlugPageResources {
  readonly curveTexture: DataTexture;
  readonly curveWidth: number;
  readonly headerTexture: DataTexture;
  readonly headerWidth: number;
  readonly referenceTexture: DataTexture;
  readonly referenceWidth: number;
}

/** Optional coverage controls. Omitted fields keep the canonical non-zero winding rule with no weight compensation. */
export interface TslSlugFillRule {
  readonly evenOdd?: Node<'bool'>;
  readonly weightBoost?: Node<'bool'>;
  readonly stemDarken?: Node<'float'>;
  readonly thicken?: Node<'float'>;
}

/**
 * The GPU resources one Slug glyph batch binds. The clip-space rows and viewport drive the analytic half-pixel
 * dilation, so they must describe the same draw the returned position node feeds.
 */
interface TslSlugShaderResourceBase {
  readonly page: TslSlugPageResources;
  /** Drawing-buffer size in device pixels. */
  readonly viewport: Node<'vec2'>;
  readonly fillRule?: TslSlugFillRule;
}

interface TslSlugShaderRowResources extends TslSlugShaderResourceBase {
  readonly modelViewProjectionRow0: Node<'vec4'>;
  readonly modelViewProjectionRow1: Node<'vec4'>;
  readonly modelViewProjectionRow3: Node<'vec4'>;
  readonly modelViewProjection?: never;
}

interface TslSlugShaderMatrixResources extends TslSlugShaderResourceBase {
  /** Exact MVP selected per glyph when a renderer batches multiple model transforms into one draw. */
  readonly modelViewProjection: Node<'mat4'>;
  readonly modelViewProjectionRow0?: never;
  readonly modelViewProjectionRow1?: never;
  readonly modelViewProjectionRow3?: never;
}

export type TslSlugShaderResources = TslSlugShaderRowResources | TslSlugShaderMatrixResources;

/**
 * Everything the canonical Slug graph produces, so a program can consume a stage or compose over its final output.
 *
 * Unlike Bitmap this output publishes no `clipPosition`: Slug integrates coverage analytically from outlines, so it is
 * correct at any subpixel placement and must keep the default projection rather than snap to the physical pixel grid.
 */
export interface TslSlugShaderOutput {
  /** Dilated glyph-quad position. Reading it from a vertex node is what publishes `renderCoordinate`. */
  readonly position: Node<'vec3'>;
  /** Interpolated em-space coordinate the coverage integral is evaluated at. */
  readonly renderCoordinate: Node<'vec2'>;
  /** Analytic fill coverage before paint alpha. */
  readonly coverage: Node<'float'>;
  readonly color: Node<'vec3'>;
  readonly opacity: Node<'float'>;
}

/**
 * Builds the canonical Slug node graph. This is the exact graph the command-buffer executor renders, so a program that composes
 * over the returned nodes inherits the technique's band walk, quadratic solve, and antialiasing footprint.
 *
 * `position` and `coverage` are two halves of one graph: the vertex half writes the varying the fragment half
 * integrates over. A program that uses `coverage` must also drive its material position from `position`.
 *
 * The graph reads `positionLocal` from the technique's unit quad, which must span `[0, 1]` with the origin at the
 * glyph's upper-left corner. A program supplying different geometry owns that correspondence.
 */
export function slugShader(instance: TslSlugInstanceNodes, resources: TslSlugShaderResources): TslSlugShaderOutput {
  const renderCoordinate = TSL.varyingProperty('vec2', 'pmndrsSlugRenderCoordinate');
  const position = TSL.Fn(() => {
    const localPosition = TSL.vec2(
      instance.origin.x.add(TSL.positionLocal.x.mul(instance.size.x)),
      instance.origin.y.add(TSL.positionLocal.y.mul(instance.size.y)).negate(),
    );
    const outwardNormal = TSL.vec2(
      TSL.positionLocal.x.sub(0.5).mul(instance.size.x),
      TSL.positionLocal.y.sub(0.5).mul(instance.size.y).negate(),
    );
    const emCoordinate = TSL.vec2(
      instance.emOrigin.x.add(TSL.positionLocal.x.mul(instance.emSize.x)),
      instance.emOrigin.y.sub(TSL.positionLocal.y.mul(instance.emSize.y)),
    );
    const dilated =
      resources.modelViewProjection === undefined
        ? slugDilate(
            localPosition,
            outwardNormal,
            emCoordinate,
            instance.inverseScale,
            resources.modelViewProjectionRow0,
            resources.modelViewProjectionRow1,
            resources.modelViewProjectionRow3,
            resources.viewport,
          )
        : slugDilateMatrix(
            localPosition,
            outwardNormal,
            emCoordinate,
            instance.inverseScale,
            resources.modelViewProjection,
            resources.viewport,
          );
    renderCoordinate.assign(dilated.textureCoordinate);
    return TSL.vec3(dilated.position.x, dilated.position.y, 0);
  })();
  const coverage: Node<'float'> = TSL.Fn(() =>
    slugRender(
      resources.page,
      {
        curveBaseTexel: instance.curveBaseTexel,
        horizontalHeaderBase: instance.horizontalHeaderBase,
        verticalHeaderBase: instance.verticalHeaderBase,
        referenceBase: instance.referenceBase,
        horizontalBandCount: instance.horizontalBandCount,
        verticalBandCount: instance.verticalBandCount,
        bandTransform: instance.bandTransform,
      },
      renderCoordinate,
      renderOptions(resources.fillRule),
    ),
  )();

  return {
    position,
    renderCoordinate,
    coverage,
    color: instance.color.rgb,
    opacity: instance.color.a.mul(coverage),
  };
}

function renderOptions(rule: TslSlugFillRule | undefined): SlugRenderOptions {
  return {
    evenOdd: rule?.evenOdd ?? TSL.bool(false),
    weightBoost: rule?.weightBoost ?? TSL.bool(false),
    ...(rule?.stemDarken === undefined ? {} : { stemDarken: rule.stemDarken }),
    ...(rule?.thicken === undefined ? {} : { thicken: rule.thicken }),
  };
}
