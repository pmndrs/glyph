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
  /** Texture-array layer containing this glyph's coverage. */
  readonly pageIndex: Node<'uint'>;
}

/** The GPU resources one Bitmap glyph batch binds: the single-channel coverage page its strike binding selected. */
export interface ThreeBitmapShaderResources {
  /** Coverage page uploaded in the atlas's own top-down row order, so `flipY` must stay disabled. */
  readonly page: Texture;
}

/** Everything the canonical Bitmap graph produces, so a program can consume a stage or compose over its final output. */
export interface ThreeBitmapShaderOutput {
  readonly position: Node<'vec3'>;
  /**
   * Clip-space vertex position with the projected quad edges snapped to the physical pixel grid. Bitmap coverage is
   * authored as one atlas texel per device pixel, so a quad landing between pixel centres resamples the strike instead
   * of reproducing it. A program must assign this to `material.vertexNode` to inherit that placement.
   */
  readonly clipPosition: Node<'vec4'>;
  /** Atlas coordinate the page is sampled at, in the page's own top-down texel space. */
  readonly atlasUv: Node<'vec2'>;
  /** Sampled glyph coverage before paint alpha. */
  readonly coverage: Node<'float'>;
  readonly color: Node<'vec3'>;
  readonly opacity: Node<'float'>;
}

/**
 * Builds the canonical Bitmap node graph. This is the exact graph the command-buffer executor renders, so a program that
 * composes over the returned nodes inherits the technique's coverage sampling and pixel snapping instead of
 * reimplementing them.
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
    instance.uvOrigin.y.add(TSL.uv().y.mul(instance.uvSize.y)),
  );
  const coverage = TSL.texture(resources.page, atlasUv).depth(instance.pageIndex).r;
  return {
    position: TSL.vec3(
      instance.origin.x.add(TSL.positionLocal.x.mul(instance.size.x)),
      instance.origin.y.add(TSL.positionLocal.y.mul(instance.size.y)).negate(),
      0,
    ),
    clipPosition: pixelSnappedClipPosition(),
    atlasUv,
    coverage,
    color: instance.color.rgb,
    opacity: instance.color.a.mul(coverage),
  };
}

/**
 * Rounds the projected quad to whole physical pixels. Snapping in clip space rather than in layout units keeps the
 * paragraph transform, camera, and device pixel ratio out of the technique: whatever chain produced the clip position,
 * its device-space landing is what has to sit on the grid the atlas was baked for.
 */
function pixelSnappedClipPosition(): Node<'vec4'> {
  const clip: Node<'vec4'> = TSL.modelViewProjection;
  return TSL.vec4(
    snapClipAxis(clip.x, clip.w, TSL.screenSize.x),
    snapClipAxis(clip.y, clip.w, TSL.screenSize.y),
    clip.z,
    clip.w,
  );
}

function snapClipAxis(clipAxis: Node<'float'>, clipW: Node<'float'>, physicalSize: Node<'float'>): Node<'float'> {
  const normalizedDevicePosition = clipAxis.mul(TSL.reciprocal(clipW));
  const physicalPosition = normalizedDevicePosition.add(1).mul(physicalSize.mul(0.5));
  const normalizedPhysicalPosition = TSL.round(physicalPosition).mul(TSL.reciprocal(physicalSize));
  return normalizedPhysicalPosition.mul(2).sub(1).mul(clipW);
}
