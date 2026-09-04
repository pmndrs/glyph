import tgpu, { type TgpuBindGroupLayout, type TgpuFn, type TgpuLayoutTexture } from 'typegpu';
import * as d from 'typegpu/data';
import * as std from 'typegpu/std';

/** One glyph instance's canonical Bitmap fields, as a typed GPU schema; Core owns field meaning, the program owns how it's addressed (buffer, attribute, or uniform). */
export const TypeGpuBitmapInstance: d.WgslStruct<{
  origin: d.Vec2f;
  size: d.Vec2f;
  uvOrigin: d.Vec2f;
  uvSize: d.Vec2f;
  color: d.Vec4f;
  pageIndex: d.U32;
}> = d.struct({
  /** Paragraph-local glyph origin, with y measured downward. */
  origin: d.vec2f,
  /** Glyph quad extent in paragraph-local units. */
  size: d.vec2f,
  /** Upper-left atlas coordinate of the glyph's coverage rectangle. */
  uvOrigin: d.vec2f,
  /** Atlas extent of the glyph's coverage rectangle. */
  uvSize: d.vec2f,
  /** Resolved paint colour with alpha, unpremultiplied. */
  color: d.vec4f,
  /** Texture-array layer containing this glyph's coverage. */
  pageIndex: d.u32,
});
export type TypeGpuBitmapInstance = d.InferGPU<typeof TypeGpuBitmapInstance>;

/** Single-channel coverage pages uploaded in the atlas's own top-down row order — flipY-style host settings must stay disabled; read as exact clamped texels, no sampler. */
export const TypeGpuBitmapPageLayout: TgpuBindGroupLayout<{
  page: TgpuLayoutTexture<d.WgslTexture2dArray<d.F32>> & { visibility?: readonly ['fragment'] };
}> = tgpu.bindGroupLayout({
  page: { texture: d.texture2dArray(d.f32), visibility: ['fragment'] },
});

/** Everything the vertex stage reads besides the instance: the unit quad and the draw's projection. */
export const TypeGpuBitmapVertexInput: d.WgslStruct<{
  quadPosition: d.Vec2f;
  quadUv: d.Vec2f;
  instance: typeof TypeGpuBitmapInstance;
  modelViewProjection: d.Mat4x4f;
  screenSize: d.Vec2f;
}> = d.struct({
  /** Unit-quad coordinate spanning `[0, 1]`, origin at upper-left — the coordinate `/tsl` reads from `positionLocal`; different geometry must preserve that correspondence. */
  quadPosition: d.vec2f,
  /** Unit-quad texture coordinate, the coordinate `/tsl` reads from `uv()`; equals `quadPosition` but carried separately since `/tsl` reads them independently. */
  quadUv: d.vec2f,
  instance: TypeGpuBitmapInstance,
  /** Column-major model-view-projection, the same matrix chain a Three renderer would apply to `position`. */
  modelViewProjection: d.mat4x4f,
  /** Drawing-buffer size in physical pixels. Read only by the pixel-snapped vertex variant. */
  screenSize: d.vec2f,
});
export type TypeGpuBitmapVertexInput = d.InferGPU<typeof TypeGpuBitmapVertexInput>;

/** Unlike `/tsl`, which leaves object-space `position` for the renderer's projection, this carries clip-space placement directly: `clipPosition` is what a program assigns to `@builtin(position)`. */
export const TypeGpuBitmapVertexOutput: d.WgslStruct<{
  position: d.Vec3f;
  clipPosition: d.Vec4f;
  atlasUv: d.Vec2f;
  color: d.Vec4f;
  pageLayer: d.U32;
}> = d.struct({
  /** Glyph-quad position in paragraph space, y upward, z zero. */
  position: d.vec3f,
  /** Clip-space vertex position selected by the variant: default projection, or pixel-snapped. */
  clipPosition: d.vec4f,
  /** Atlas coordinate the page is sampled at, in the page's own top-down texel space. */
  atlasUv: d.vec2f,
  /** Resolved paint colour passed through to the fragment stage. */
  color: d.vec4f,
  /** Texture-array layer containing this glyph's coverage. */
  pageLayer: d.u32,
});
export type TypeGpuBitmapVertexOutput = d.InferGPU<typeof TypeGpuBitmapVertexOutput>;

/** Everything the fragment stage reads: the interpolated varyings of one glyph quad. */
export const TypeGpuBitmapFragmentInput: d.WgslStruct<{
  atlasUv: d.Vec2f;
  color: d.Vec4f;
  pageLayer: d.U32;
}> = d.struct({
  atlasUv: d.vec2f,
  color: d.vec4f,
  pageLayer: d.u32,
});
export type TypeGpuBitmapFragmentInput = d.InferGPU<typeof TypeGpuBitmapFragmentInput>;

/** Everything the canonical Bitmap fragment stage produces; a program can consume the final result or compose over coverage before paint alpha. */
export const TypeGpuBitmapFragmentOutput: d.WgslStruct<{
  coverage: d.F32;
  color: d.Vec3f;
  opacity: d.F32;
}> = d.struct({
  /** Sampled glyph coverage before paint alpha. */
  coverage: d.f32,
  color: d.vec3f,
  opacity: d.f32,
});
export type TypeGpuBitmapFragmentOutput = d.InferGPU<typeof TypeGpuBitmapFragmentOutput>;

/** Atlas coordinate the coverage page is sampled at, in the page's own top-down texel space. */
export function bitmapAtlasUv(uvOrigin: d.v2f, uvSize: d.v2f, quadUv: d.v2f): d.v2f {
  'use gpu';

  return d.vec2f(uvOrigin.x + quadUv.x * uvSize.x, uvOrigin.y + quadUv.y * uvSize.y);
}

/** Glyph-quad position in paragraph space, with its downward y flipped upward. */
export function bitmapQuadPosition(origin: d.v2f, size: d.v2f, quadPosition: d.v2f): d.v3f {
  'use gpu';

  return d.vec3f(origin.x + quadPosition.x * size.x, -(origin.y + quadPosition.y * size.y), 0);
}

/** Rounds a clip-space axis onto whole physical pixels in clip space (not paragraph space), so any transform/camera/DPR lands on the atlas's baked grid; operation order matches the TSL realization exactly. */
export function snapClipAxis(clipAxis: number, clipW: number, physicalSize: number): number {
  'use gpu';

  const normalizedDevicePosition = clipAxis * (1 / clipW);
  const physicalPosition = (normalizedDevicePosition + 1) * (physicalSize * 0.5);
  return (std.round(physicalPosition) * (1 / physicalSize) * 2 - 1) * clipW;
}

/** Projects the glyph quad through the draw's model-view-projection without pixel snapping. */
export function projectClipPosition(modelViewProjection: d.m4x4f, position: d.v3f): d.v4f {
  'use gpu';

  return std.mul(modelViewProjection, d.vec4f(position.x, position.y, position.z, 1));
}

/** The canonical Bitmap vertex stage under the default projection; a program wanting pixel snapping (sharp at rest, quantizes animated motion) binds `bitmapVertexSnapped` instead. */
export const bitmapVertex: TgpuFn<(input: typeof TypeGpuBitmapVertexInput) => typeof TypeGpuBitmapVertexOutput> =
  tgpu.fn(
    [TypeGpuBitmapVertexInput],
    TypeGpuBitmapVertexOutput,
  )((input) => {
    'use gpu';

    const instance = input.instance;
    const position = bitmapQuadPosition(instance.origin, instance.size, input.quadPosition);
    return TypeGpuBitmapVertexOutput({
      position,
      clipPosition: projectClipPosition(input.modelViewProjection, position),
      atlasUv: bitmapAtlasUv(instance.uvOrigin, instance.uvSize, input.quadUv),
      color: instance.color,
      pageLayer: instance.pageIndex,
    });
  });

/** The pixel-snapped Bitmap vertex stage: same graph with projected x/y rounded onto whole physical pixels — sharp at rest, but quantizes animated motion. */
export const bitmapVertexSnapped: TgpuFn<(input: typeof TypeGpuBitmapVertexInput) => typeof TypeGpuBitmapVertexOutput> =
  tgpu.fn(
    [TypeGpuBitmapVertexInput],
    TypeGpuBitmapVertexOutput,
  )((input) => {
    'use gpu';

    const instance = input.instance;
    const position = bitmapQuadPosition(instance.origin, instance.size, input.quadPosition);
    const clip = projectClipPosition(input.modelViewProjection, position);
    return TypeGpuBitmapVertexOutput({
      position,
      clipPosition: d.vec4f(
        snapClipAxis(clip.x, clip.w, input.screenSize.x),
        snapClipAxis(clip.y, clip.w, input.screenSize.y),
        clip.z,
        clip.w,
      ),
      atlasUv: bitmapAtlasUv(instance.uvOrigin, instance.uvSize, input.quadUv),
      color: instance.color,
      pageLayer: instance.pageIndex,
    });
  });

/** Paint composition over resolved coverage: unpremultiplied colour with alpha scaled by glyph coverage. */
export function bitmapPaint(coverage: number, color: d.v4f): TypeGpuBitmapFragmentOutput {
  'use gpu';

  return TypeGpuBitmapFragmentOutput({
    coverage,
    color: d.vec3f(color.r, color.g, color.b),
    opacity: color.a * coverage,
  });
}

/** Coverage of one atlas coordinate: clamped into the page, scaled onto the texel grid, floored, bound-clamped — the same nearest-texel fetch the `/tsl` realization compiles to. */
export function bitmapPageCoverage(page: d.texture2dArray<d.F32>, atlasUv: d.v2f, pageLayer: number): number {
  'use gpu';

  const dimensions = std.textureDimensions(page, 0);
  const clampedUv = d.vec2f(std.clamp(atlasUv.x, 0, 1), std.clamp(atlasUv.y, 0, 1));
  const scaledCoord = d.vec2f(clampedUv.x * d.f32(dimensions.x), clampedUv.y * d.f32(dimensions.y));
  const flooredCoord = d.vec2f(std.floor(scaledCoord.x), std.floor(scaledCoord.y));
  const boundedCoord = d.vec2u(
    d.u32(std.clamp(flooredCoord.x, 0, d.f32(dimensions.x - 1))),
    d.u32(std.clamp(flooredCoord.y, 0, d.f32(dimensions.y - 1))),
  );
  return std.textureLoad(page, boundedCoord, pageLayer, 0).x;
}

/** The canonical Bitmap fragment stage: single-channel coverage fetched from the bound page array, then composed with the paint colour. */
export const bitmapFragment: TgpuFn<(input: typeof TypeGpuBitmapFragmentInput) => typeof TypeGpuBitmapFragmentOutput> =
  tgpu.fn(
    [TypeGpuBitmapFragmentInput],
    TypeGpuBitmapFragmentOutput,
  )((input) => {
    'use gpu';

    const coverage = bitmapPageCoverage(TypeGpuBitmapPageLayout.$.page, input.atlasUv, input.pageLayer);
    return bitmapPaint(coverage, input.color);
  });
