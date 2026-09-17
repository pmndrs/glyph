import { max, mix, smoothstep, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { defineTextMaterial } from '@pmndrs/glyph/three';
import { defineTextMaterial as defineExperimentalTextMaterial } from '@pmndrs/glyph/three/typegpu';
import type { TslMsdfShaderOutput } from '@pmndrs/glyph/shaders/tsl';
import {
  msdfRenderDetailed,
  type TypeGpuMsdfFragmentOutput,
  type TypeGpuMsdfRenderInput,
} from '@pmndrs/glyph/shaders/typegpu';

for (const defineMaterial of [defineTextMaterial, defineExperimentalTextMaterial]) {
  defineMaterial((context) => {
    const material = context.createDefaultMaterial();
    if (context.kind === 'glyph' && context.format === 'pmndrs.msdf') {
      const shader: TslMsdfShaderOutput = context.shader;
      const fillPixels: Node<'float'> = shader.fillDistance.mul(shader.pixelRange);
      const truePixels: Node<'float'> = shader.trueDistance.mul(shader.pixelRange);
      const glow = smoothstep(-3, 0, truePixels);
      material.colorNode = mix(vec3(0, 0.5, 1), shader.color, shader.fillCoverage);
      material.opacityNode = max(shader.opacity, glow.mul(0.35));
      void fillPixels;
    }
    return material;
  });
}

declare const output: TypeGpuMsdfFragmentOutput;
declare const input: TypeGpuMsdfRenderInput;
const detailedOutput: TypeGpuMsdfFragmentOutput = msdfRenderDetailed(input);
const fillPixels: number = output.fillDistance * output.pixelRange;
const truePixels: number = output.trueDistance * output.pixelRange;
void detailedOutput;
void fillPixels;
void truePixels;
