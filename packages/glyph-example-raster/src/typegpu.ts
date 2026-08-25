import tgpu, { type TgpuFn } from 'typegpu';
import * as d from 'typegpu/data';
import * as std from 'typegpu/std';

import { glyphExampleShaderContract, type GlyphExampleShaderVariant } from './shader-contract.js';
import './portable.js';

export const TypeGpuGlyphExampleInstance: d.WgslStruct<{
  origin: d.Vec2f;
  size: d.Vec2f;
  color: d.Vec4f;
}> = d.struct({ origin: d.vec2f, size: d.vec2f, color: d.vec4f });
export type TypeGpuGlyphExampleInstance = d.InferGPU<typeof TypeGpuGlyphExampleInstance>;

export const TypeGpuGlyphExampleVertexInput: d.WgslStruct<{
  quadPosition: d.Vec2f;
  quadUv: d.Vec2f;
  instance: typeof TypeGpuGlyphExampleInstance;
}> = d.struct({ quadPosition: d.vec2f, quadUv: d.vec2f, instance: TypeGpuGlyphExampleInstance });
export type TypeGpuGlyphExampleVertexInput = d.InferGPU<typeof TypeGpuGlyphExampleVertexInput>;

export const TypeGpuGlyphExampleVertexOutput: d.WgslStruct<{
  position: d.Vec3f;
  color: d.Vec4f;
  quadUv: d.Vec2f;
}> = d.struct({ position: d.vec3f, color: d.vec4f, quadUv: d.vec2f });
export type TypeGpuGlyphExampleVertexOutput = d.InferGPU<typeof TypeGpuGlyphExampleVertexOutput>;

export const TypeGpuGlyphExampleFragmentInput: d.WgslStruct<{
  color: d.Vec4f;
  quadUv: d.Vec2f;
}> = d.struct({ color: d.vec4f, quadUv: d.vec2f });
export type TypeGpuGlyphExampleFragmentInput = d.InferGPU<typeof TypeGpuGlyphExampleFragmentInput>;

export const glyphExampleTypeGpuVariant: GlyphExampleShaderVariant = Object.freeze({
  language: 'typegpu',
  techniqueId: glyphExampleShaderContract.techniqueId,
  geometry: glyphExampleShaderContract.geometry,
  buffers: glyphExampleShaderContract.buffers,
  resources: glyphExampleShaderContract.resources,
  outputs: glyphExampleShaderContract.outputs,
  resource: glyphExampleShaderContract.resource,
  geometryResource: glyphExampleShaderContract.geometryResource,
});

export const glyphExampleVertex: TgpuFn<
  (input: typeof TypeGpuGlyphExampleVertexInput) => typeof TypeGpuGlyphExampleVertexOutput
> = tgpu.fn(
  [TypeGpuGlyphExampleVertexInput],
  TypeGpuGlyphExampleVertexOutput,
)((input) => {
  'use gpu';

  const instance = input.instance;
  const position = d.vec3f(
    instance.origin.x + input.quadPosition.x * instance.size.x,
    -(instance.origin.y + input.quadPosition.y * instance.size.y),
    0,
  );
  return TypeGpuGlyphExampleVertexOutput({ position, color: instance.color, quadUv: input.quadUv });
});

export const glyphExampleFragment: TgpuFn<(input: typeof TypeGpuGlyphExampleFragmentInput) => d.Vec4f> = tgpu.fn(
  [TypeGpuGlyphExampleFragmentInput],
  d.vec4f,
)((input) => {
  'use gpu';

  const edgeDistance = stdMin(stdMin(input.quadUv.x, 1 - input.quadUv.x), stdMin(input.quadUv.y, 1 - input.quadUv.y));
  return d.vec4f(input.color.r, input.color.g, input.color.b, input.color.a * (1 - std.step(0.08, edgeDistance)));
});

function stdMin(left: number, right: number): number {
  'use gpu';
  return std.min(left, right);
}
