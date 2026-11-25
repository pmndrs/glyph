import tgpu, {
  type TgpuAccessor,
  type TgpuBindGroupLayout,
  type TgpuFn,
  type TgpuLayoutSampler,
  type TgpuLayoutTexture,
  type TgpuSlot,
  d,
  std,
} from 'typegpu';

/** One glyph instance's canonical Bitmap fields, as a typed GPU schema; Core owns field meaning, the program owns how it's addressed (buffer, attribute, or uniform). */
export const TypeGpuBitmapInstance: d.WgslStruct<{
  origin: d.Vec2f;
  size: d.Vec2f;
  uvOrigin: d.Vec2f;
  uvSize: d.Vec2f;
  color: d.Vec4f;
  pageIndex: d.U32;
}> = /* @__PURE__ */ d.struct({
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

/** Single-channel coverage pages uploaded in the atlas's own top-down row order — flipY-style host settings must stay disabled — and the filtering sampler they are read through. The sampler chooses the filter: bind a linear, clamp-to-edge one to draw what `/tsl` draws, or a nearest one to draw what the integrations draw under `bitmapFilter: 'nearest'`; the WGSL is the same. */
export const TypeGpuBitmapPageLayout: TgpuBindGroupLayout<{
  page: TgpuLayoutTexture<d.WgslTexture2dArray<d.F32>> & { visibility?: readonly ['fragment'] };
  sampler: TgpuLayoutSampler & { visibility?: readonly ['fragment'] };
}> = /* @__PURE__ */ tgpu.bindGroupLayout({
  page: { texture: /* @__PURE__ */ d.texture2dArray(d.f32), visibility: ['fragment'] },
  sampler: { sampler: 'filtering', visibility: ['fragment'] },
});

/**
 * The default Bitmap page source. A host can replace it with a texture view, raw WebGPU view, or a function returning
 * either; the sampler still comes from `TypeGpuBitmapPageLayout`. A host that owns both replaces `bitmapCoverageSlot`.
 */
export const bitmapPageAccessor: TgpuAccessor<d.WgslTexture2dArray<d.F32>> = /* @__PURE__ */ tgpu.accessor(
  /* @__PURE__ */ d.texture2dArray(d.f32),
  () => TypeGpuBitmapPageLayout.$.page,
);

/** Everything the vertex stage reads besides the instance: the unit quad and the draw's projection. */
export const TypeGpuBitmapVertexInput: d.WgslStruct<{
  quadPosition: d.Vec2f;
  quadUv: d.Vec2f;
  instance: typeof TypeGpuBitmapInstance;
  modelViewProjection: d.Mat4x4f;
  screenSize: d.Vec2f;
}> = /* @__PURE__ */ d.struct({
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
}> = /* @__PURE__ */ d.struct({
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
}> = /* @__PURE__ */ d.struct({
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
}> = /* @__PURE__ */ d.struct({
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

/**
 * Where a projected position rounds: to the nearest pixel boundary, except that one within 1/256 px above a halfway
 * point rounds down. Bitmap strike quads at whole-pixel text positions sit exactly halfway (their baselines fall on
 * half pixels), and the two corners of a quad reach the halfway point through different float error; a plain
 * `round()` then sends them different ways (and WGSL rounds halves to even), stretching the quad by a pixel. Every
 * corner of a 1:1 quad shares its fraction, so a threshold off the halfway point keeps the quad whole on every backend.
 */
const SNAP_ROUNDING_OFFSET = 0.5 - 1 / 256;

/** Rounds a clip-space axis onto whole physical pixels in clip space (not paragraph space), so any transform/camera/DPR lands on the atlas's baked grid; operation order matches the TSL realization exactly. */
export function snapClipAxis(clipAxis: number, clipW: number, physicalSize: number): number {
  'use gpu';

  const normalizedDevicePosition = clipAxis * (1 / clipW);
  const physicalPosition = (normalizedDevicePosition + 1) * (physicalSize * 0.5);
  return (std.floor(physicalPosition + SNAP_ROUNDING_OFFSET) * (1 / physicalSize) * 2 - 1) * clipW;
}

/** A clip-space axis in physical pixels; `clip` is (axis, w). */
function physicalAxis(clip: d.v2f, physicalSize: number): number {
  'use gpu';

  return (clip.x * (1 / clip.y) + 1) * (physicalSize * 0.5);
}

/**
 * Where a corner of a pixel-snapped text's decoration lands along the block axis, in clip space: its line's baseline
 * snapped as the text's glyphs snap theirs, then the rectangle's offset from that baseline and its thickness (at least
 * one pixel) each rounded by the same rule. A glyph and its underline therefore keep the same whole-pixel distance at
 * every sub-pixel position. `top`, `bottom` and `baseline` are (axis, w) of the rectangle's two block edges and its
 * baseline under the corner; `bottomCorner` is 1 for a corner on the bottom edge, 0 on the top.
 */
export function snapDecorationClipAxis(
  top: d.v2f,
  bottom: d.v2f,
  baseline: d.v2f,
  bottomCorner: number,
  clipW: number,
  physicalSize: number,
): number {
  'use gpu';

  const topPixel = physicalAxis(top, physicalSize);
  const baselinePixel = physicalAxis(baseline, physicalSize);
  const extent = physicalAxis(bottom, physicalSize) - topPixel;
  const snappedTop =
    std.floor(baselinePixel + SNAP_ROUNDING_OFFSET) + std.floor(topPixel - baselinePixel + SNAP_ROUNDING_OFFSET);
  const thickness = std.max(1, std.floor(std.abs(extent) + SNAP_ROUNDING_OFFSET));
  const snapped = snappedTop + bottomCorner * std.sign(extent) * thickness;
  return (snapped * (1 / physicalSize) * 2 - 1) * clipW;
}

/** Projects the glyph quad through the draw's model-view-projection without pixel snapping. */
export function projectClipPosition(modelViewProjection: d.m4x4f, position: d.v3f): d.v4f {
  'use gpu';

  return std.mul(modelViewProjection, d.vec4f(position.x, position.y, position.z, 1));
}

/** The canonical Bitmap vertex stage under the default projection; a program wanting pixel snapping (sharp at rest, quantizes animated motion) binds `bitmapVertexSnapped` instead. */
export const bitmapVertex: TgpuFn<(input: typeof TypeGpuBitmapVertexInput) => typeof TypeGpuBitmapVertexOutput> =
  /* @__PURE__ */ tgpu.fn(
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
  /* @__PURE__ */ tgpu.fn(
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

/** Compact Bitmap paint result for node-system adapters that already resolved coverage at their resource boundary. */
export function bitmapPaintCoverageOpacity(coverage: number, color: d.v4f): d.v2f {
  'use gpu';

  const output = bitmapPaint(coverage, color);
  return d.vec2f(output.coverage, output.opacity);
}

/**
 * Coverage of one atlas coordinate: one filtered sample of the page's only level, the read the `/tsl` realization makes
 * through its linear, clamp-to-edge page texture. A strike drawn on its own pixel grid reads exact texels; a strike drawn
 * between pixels or at another size is interpolated instead of aliased.
 */
export function bitmapPageCoverage(
  page: d.texture2dArray<d.F32>,
  sampler: d.sampler,
  atlasUv: d.v2f,
  pageLayer: number,
): number {
  'use gpu';

  return std.textureSampleLevel(page, sampler, atlasUv, pageLayer, 0).x;
}

/** Resource-polymorphic coverage lookup used by the canonical fragment stage. */
export type BitmapCoverageSource = (atlasUv: d.v2f, pageLayer: number) => number;

function bitmapAccessorCoverage(atlasUv: d.v2f, pageLayer: number): number {
  'use gpu';
  return bitmapPageCoverage(bitmapPageAccessor.$, TypeGpuBitmapPageLayout.$.sampler, atlasUv, pageLayer);
}

/** Override for procedural or host-indirected coverage; the default samples `bitmapPageAccessor` through the layout's sampler. */
export const bitmapCoverageSlot: TgpuSlot<BitmapCoverageSource> = /* @__PURE__ */ tgpu.slot(bitmapAccessorCoverage);

/** The canonical Bitmap fragment stage: single-channel coverage sampled from the bound page array, then composed with the paint colour. */
export const bitmapFragment: TgpuFn<(input: typeof TypeGpuBitmapFragmentInput) => typeof TypeGpuBitmapFragmentOutput> =
  /* @__PURE__ */ tgpu.fn(
    [TypeGpuBitmapFragmentInput],
    TypeGpuBitmapFragmentOutput,
  )((input) => {
    'use gpu';

    const coverage = bitmapCoverageSlot.$(input.atlasUv, input.pageLayer);
    return bitmapPaint(coverage, input.color);
  });
