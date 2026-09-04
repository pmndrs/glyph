import * as TSL from 'three/tsl';
import type { Node, Texture } from 'three/webgpu';

// Upstream types this export as an unparameterized `Node`; it is always vec4. Narrow once, not per use.
const modelViewProjection = TSL.modelViewProjection as Node<'vec4'>;

/** One glyph instance's canonical Bitmap fields, resolved to nodes; Core owns field meaning, the program owns how it's addressed (buffer, attribute, or texture). */
export interface TslBitmapInstanceNodes {
  /** Paragraph-local glyph origin, with y measured downward. */
  readonly origin: Node<'vec2'>;
  /** Glyph quad extent in paragraph-local units. */
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
export interface TslBitmapShaderResources {
  /** Coverage page uploaded in the atlas's own top-down row order, so `flipY` must stay disabled. */
  readonly page: Texture;
}

export interface TslBitmapShaderOptions {
  /** Snap projected vertices to physical pixels. Disabled by default so animated transforms retain subpixel motion. */
  readonly pixelSnapping?: boolean;
}

/** Everything the canonical Bitmap graph produces, so a program can consume a stage or compose over its final output. */
export interface TslBitmapShaderOutput {
  readonly position: Node<'vec3'>;
  /** Clip-space vertex position selected by the shader options; assign to `material.vertexNode`. Pixel snapping is opt-in — sharp at rest, but quantizes animated motion. */
  readonly clipPosition: Node<'vec4'>;
  /** Atlas coordinate the page is sampled at, in the page's own top-down texel space. */
  readonly atlasUv: Node<'vec2'>;
  /** Sampled glyph coverage before paint alpha. */
  readonly coverage: Node<'float'>;
  readonly color: Node<'vec3'>;
  readonly opacity: Node<'float'>;
}

/** Builds the canonical Bitmap graph the executor renders; composing over it inherits coverage sampling and snapping. Reads `positionLocal`/`uv()` from a `[0, 1]` unit quad, origin at upper-left — different geometry must preserve that correspondence. */
export function bitmapShader(
  instance: TslBitmapInstanceNodes,
  resources: TslBitmapShaderResources,
  options: TslBitmapShaderOptions = {},
): TslBitmapShaderOutput {
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
    clipPosition: options.pixelSnapping === true ? pixelSnappedClipPosition() : modelViewProjection,
    atlasUv,
    coverage,
    color: instance.color.rgb,
    opacity: instance.color.a.mul(coverage),
  };
}

/** Rounds the projected quad to whole physical pixels in clip space (not paragraph space), so it works regardless of transform/camera/DPR — matching the grid the atlas was baked for. */
function pixelSnappedClipPosition(): Node<'vec4'> {
  const clip = modelViewProjection;
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
