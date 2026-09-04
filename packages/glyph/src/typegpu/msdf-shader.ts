import tgpu, { d, std, type TgpuAccessor, type TgpuFn, type TgpuSlot } from 'typegpu';

export const TypeGpuMsdfInstance: d.WgslStruct<{
  origin: d.Vec2f;
  size: d.Vec2f;
  uvOrigin: d.Vec2f;
  uvSize: d.Vec2f;
  uvBounds: d.Vec4f;
  fillColor: d.Vec4f;
  outlineColor: d.Vec4f;
  shadowColor: d.Vec4f;
  shadowOffset: d.Vec2f;
  outlineWidth: d.F32;
  pageIndex: d.U32;
}> = d.struct({
  origin: d.vec2f,
  size: d.vec2f,
  uvOrigin: d.vec2f,
  uvSize: d.vec2f,
  uvBounds: d.vec4f,
  fillColor: d.vec4f,
  outlineColor: d.vec4f,
  shadowColor: d.vec4f,
  shadowOffset: d.vec2f,
  outlineWidth: d.f32,
  pageIndex: d.u32,
});
export type TypeGpuMsdfInstance = d.InferGPU<typeof TypeGpuMsdfInstance>;

export const TypeGpuMsdfVertexInput: d.WgslStruct<{
  unitPosition: d.Vec3f;
  unitUv: d.Vec2f;
  instance: typeof TypeGpuMsdfInstance;
}> = d.struct({
  unitPosition: d.vec3f,
  unitUv: d.vec2f,
  instance: TypeGpuMsdfInstance,
});
export type TypeGpuMsdfVertexInput = d.InferGPU<typeof TypeGpuMsdfVertexInput>;

export const TypeGpuMsdfVertexOutput: d.WgslStruct<{
  position: d.Vec3f;
  atlasCoordinate: d.Vec2f;
  shadowCoordinate: d.Vec2f;
  uvBounds: d.Vec4f;
  fillColor: d.Vec4f;
  outlineColor: d.Vec4f;
  shadowColor: d.Vec4f;
  outlineWidth: d.F32;
  pageIndex: d.U32;
}> = d.struct({
  position: d.vec3f,
  atlasCoordinate: d.vec2f,
  shadowCoordinate: d.vec2f,
  uvBounds: d.vec4f,
  fillColor: d.vec4f,
  outlineColor: d.vec4f,
  shadowColor: d.vec4f,
  outlineWidth: d.f32,
  pageIndex: d.u32,
});
export type TypeGpuMsdfVertexOutput = d.InferGPU<typeof TypeGpuMsdfVertexOutput>;
export const TypeGpuMsdfFragmentInput: typeof TypeGpuMsdfVertexOutput = TypeGpuMsdfVertexOutput;
export type TypeGpuMsdfFragmentInput = TypeGpuMsdfVertexOutput;

export const TypeGpuMsdfFragmentOutput: d.WgslStruct<{
  fillCoverage: d.F32;
  outlineCoverage: d.F32;
  shadowCoverage: d.F32;
  color: d.Vec3f;
  opacity: d.F32;
}> = d.struct({
  fillCoverage: d.f32,
  outlineCoverage: d.f32,
  shadowCoverage: d.f32,
  color: d.vec3f,
  opacity: d.f32,
});
export type TypeGpuMsdfFragmentOutput = d.InferGPU<typeof TypeGpuMsdfFragmentOutput>;

export const MsdfRenderInput: d.WgslStruct<{
  atlasCoordinate: d.Vec2f;
  shadowCoordinate: d.Vec2f;
  uvBounds: d.Vec4f;
  atlasSize: d.Vec2f;
  pixelRange: d.F32;
  baseSample: d.Vec4f;
  shadowSample: d.Vec4f;
  fillColor: d.Vec4f;
  outlineColor: d.Vec4f;
  outlineWidth: d.F32;
  shadowColor: d.Vec4f;
}> = d.struct({
  atlasCoordinate: d.vec2f,
  shadowCoordinate: d.vec2f,
  uvBounds: d.vec4f,
  atlasSize: d.vec2f,
  pixelRange: d.f32,
  baseSample: d.vec4f,
  shadowSample: d.vec4f,
  fillColor: d.vec4f,
  outlineColor: d.vec4f,
  outlineWidth: d.f32,
  shadowColor: d.vec4f,
});
export type MsdfRenderInput = d.InferGPU<typeof MsdfRenderInput>;

export const MsdfCoverageInput: d.WgslStruct<{
  atlasCoordinate: d.Vec2f;
  shadowCoordinate: d.Vec2f;
  uvBounds: d.Vec4f;
  atlasSize: d.Vec2f;
  pixelRange: d.F32;
  baseSample: d.Vec4f;
  shadowSample: d.Vec4f;
  outlineWidth: d.F32;
}> = d.struct({
  atlasCoordinate: d.vec2f,
  shadowCoordinate: d.vec2f,
  uvBounds: d.vec4f,
  atlasSize: d.vec2f,
  pixelRange: d.f32,
  baseSample: d.vec4f,
  shadowSample: d.vec4f,
  outlineWidth: d.f32,
});
export type MsdfCoverageInput = d.InferGPU<typeof MsdfCoverageInput>;

export const MsdfCompositeInput: d.WgslStruct<{
  coverage: d.Vec3f;
  fillColor: d.Vec4f;
  outlineColor: d.Vec4f;
  shadowColor: d.Vec4f;
}> = d.struct({ coverage: d.vec3f, fillColor: d.vec4f, outlineColor: d.vec4f, shadowColor: d.vec4f });
export type MsdfCompositeInput = d.InferGPU<typeof MsdfCompositeInput>;

/** Atlas constants can be literals, uniforms, buffers, or GPU functions. */
export const msdfAtlasSizeAccessor: TgpuAccessor<d.Vec2f> = tgpu.accessor(d.vec2f);
export const msdfPixelRangeAccessor: TgpuAccessor<d.F32> = tgpu.accessor(d.f32);

export type MsdfSampleSource = (atlasCoordinate: d.v2f, pageIndex: number) => d.v4f;
/** A host supplies texture sampling, a procedural field, or any other semantic sample source. */
export const msdfSampleSlot: TgpuSlot<MsdfSampleSource> = tgpu.slot<MsdfSampleSource>();

/** Position one unit-quad vertex in paragraph space, converting the engine's downward y to Three's upward y. */
export function msdfPosition(origin: d.v2f, size: d.v2f, unitPosition: d.v3f): d.v3f {
  'use gpu';
  return d.vec3f(origin.x + unitPosition.x * size.x, -(origin.y + unitPosition.y * size.y), 0);
}

export function msdfAtlasCoordinate(uvOrigin: d.v2f, uvSize: d.v2f, unitUv: d.v2f): d.v2f {
  'use gpu';
  return uvOrigin.add(unitUv.mul(uvSize));
}

/** Clamp base and shadow coordinates to texel centers inside one atlas cell. */
export function msdfClampedCoordinates(
  atlasCoordinate: d.v2f,
  shadowCoordinate: d.v2f,
  uvBounds: d.v4f,
  atlasSize: d.v2f,
): d.v4f {
  'use gpu';
  const halfTexel = d.vec2f(0.5).div(atlasSize);
  const minimum = uvBounds.xy.add(halfTexel);
  const maximum = uvBounds.zw.sub(halfTexel);
  return d.vec4f(std.clamp(atlasCoordinate, minimum, maximum), std.clamp(shadowCoordinate, minimum, maximum));
}

export const msdfVertex: TgpuFn<(input: typeof TypeGpuMsdfVertexInput) => typeof TypeGpuMsdfVertexOutput> = tgpu.fn(
  [TypeGpuMsdfVertexInput],
  TypeGpuMsdfVertexOutput,
)((input) => {
  'use gpu';
  const instance = input.instance;
  const atlasCoordinate = msdfAtlasCoordinate(instance.uvOrigin, instance.uvSize, input.unitUv);
  return TypeGpuMsdfVertexOutput({
    position: msdfPosition(instance.origin, instance.size, input.unitPosition),
    atlasCoordinate,
    shadowCoordinate: atlasCoordinate.sub(instance.shadowOffset),
    uvBounds: instance.uvBounds,
    fillColor: instance.fillColor,
    outlineColor: instance.outlineColor,
    shadowColor: instance.shadowColor,
    outlineWidth: instance.outlineWidth,
    pageIndex: instance.pageIndex,
  });
});

/** Reconstruct and composite one filtered MTSDF fragment from the configured semantic resources. */
export const msdfFragment: TgpuFn<(input: typeof TypeGpuMsdfFragmentInput) => typeof TypeGpuMsdfFragmentOutput> =
  tgpu.fn(
    [TypeGpuMsdfFragmentInput],
    TypeGpuMsdfFragmentOutput,
  )((input) => {
    'use gpu';
    const atlasSize = msdfAtlasSizeAccessor.$;
    const coordinates = msdfClampedCoordinates(
      input.atlasCoordinate,
      input.shadowCoordinate,
      input.uvBounds,
      atlasSize,
    );
    const baseSample = msdfSampleSlot.$(coordinates.xy, input.pageIndex);
    const shadowSample = msdfSampleSlot.$(coordinates.zw, input.pageIndex);
    return msdfRenderDetailed(
      MsdfRenderInput({
        atlasCoordinate: input.atlasCoordinate,
        shadowCoordinate: input.shadowCoordinate,
        uvBounds: input.uvBounds,
        atlasSize,
        pixelRange: msdfPixelRangeAccessor.$,
        baseSample,
        shadowSample,
        fillColor: input.fillColor,
        outlineColor: input.outlineColor,
        outlineWidth: input.outlineWidth,
        shadowColor: input.shadowColor,
      }),
    );
  });

/** Detailed MTSDF reconstruction for hosts whose own texture system supplies the two filtered samples. */
export function msdfRenderDetailed(input: MsdfRenderInput): TypeGpuMsdfFragmentOutput {
  'use gpu';
  const coverage = msdfCoverage(
    MsdfCoverageInput({
      atlasCoordinate: input.atlasCoordinate,
      shadowCoordinate: input.shadowCoordinate,
      uvBounds: input.uvBounds,
      atlasSize: input.atlasSize,
      pixelRange: input.pixelRange,
      baseSample: input.baseSample,
      shadowSample: input.shadowSample,
      outlineWidth: input.outlineWidth,
    }),
  );
  const composite = msdfComposite(
    MsdfCompositeInput({
      coverage,
      fillColor: input.fillColor,
      outlineColor: input.outlineColor,
      shadowColor: input.shadowColor,
    }),
  );
  return TypeGpuMsdfFragmentOutput({
    fillCoverage: coverage.x,
    outlineCoverage: coverage.y,
    shadowCoverage: coverage.z,
    color: composite.rgb,
    opacity: composite.a,
  });
}

/** Backward-compatible unpremultiplied RGBA result over renderer-supplied filtered samples. */
export function msdfRender(input: MsdfRenderInput): d.v4f {
  'use gpu';
  const output = msdfRenderDetailed(input);
  return d.vec4f(output.color, output.opacity);
}

/** Fill, outline-only, and shadow coverages packed for node-system adapters. */
export function msdfCoverage(input: MsdfCoverageInput): d.v3f {
  'use gpu';
  const fillDistance = median3(input.baseSample.rgb) - 0.5;
  const trueDistance = input.baseSample.a - 0.5;
  const pixelsPerDistanceUnit = screenPixelRange(input.atlasCoordinate, input.atlasSize, input.pixelRange);
  const baseInside = insideRectangle(input.atlasCoordinate, input.uvBounds);
  const fillCoverage = distanceCoverage(fillDistance, pixelsPerDistanceUnit) * baseInside;
  const outlineCoverage = distanceCoverage(trueDistance + input.outlineWidth, pixelsPerDistanceUnit) * baseInside;
  const outlineOnly = std.max(outlineCoverage - fillCoverage, 0);
  const shadowCoverage =
    distanceCoverage(input.shadowSample.a - 0.5, pixelsPerDistanceUnit) *
    insideRectangle(input.shadowCoordinate, input.uvBounds);
  return d.vec3f(fillCoverage, outlineOnly, shadowCoverage);
}

/** Composite canonical coverages into unpremultiplied RGB and opacity. */
export function msdfComposite(input: MsdfCompositeInput): d.v4f {
  'use gpu';
  const fillAlpha = input.fillColor.a * input.coverage.x;
  const outlineAlpha = input.outlineColor.a * input.coverage.y;
  const glyphAlpha = fillAlpha + outlineAlpha;
  const shadowAlpha = input.shadowColor.a * input.coverage.z * (1 - glyphAlpha);
  const outputAlpha = glyphAlpha + shadowAlpha;
  const outputPremultiplied = input.fillColor.rgb
    .mul(fillAlpha)
    .add(input.outlineColor.rgb.mul(outlineAlpha))
    .add(input.shadowColor.rgb.mul(shadowAlpha));
  return d.vec4f(outputPremultiplied.div(std.max(outputAlpha, 1e-6)), outputAlpha);
}

function median3(value: d.v3f): number {
  'use gpu';
  return std.max(std.min(value.r, value.g), std.min(std.max(value.r, value.g), value.b));
}

function screenPixelRange(atlasCoordinate: d.v2f, atlasSize: d.v2f, pixelRange: number): number {
  'use gpu';
  const atlasUnitsPerPixel = std.max(std.fwidth(atlasCoordinate), d.vec2f(1e-6));
  const screenTexels = d.vec2f(1).div(atlasUnitsPerPixel);
  return std.max(0.5 * std.dot(d.vec2f(pixelRange).div(atlasSize), screenTexels), 1);
}

function distanceCoverage(distance: number, pixelsPerDistanceUnit: number): number {
  'use gpu';
  return std.clamp(distance * pixelsPerDistanceUnit + 0.5, 0, 1);
}

function insideRectangle(point: d.v2f, bounds: d.v4f): number {
  'use gpu';
  const inside = std.step(bounds.xy, point).mul(std.step(point, bounds.zw));
  return inside.x * inside.y;
}
