import type { ShaderBit } from '@pixi/3d';

import { msdfFragmentGlsl, msdfGlsl, msdfWgsl } from './generated/shaders.js';

/** Pixi-owned attributes, constants, and texture access around Glyph's generated TypeGPU MTSDF math. */
export const glyphMsdfBit: ShaderBit = {
  name: 'pmndrsGlyphMsdfTypeGpu',
  attributes: {
    aGlyphRect: 'float32x4',
    aGlyphUvRect: 'float32x4',
    aGlyphUvBounds: 'float32x4',
    aGlyphColor: 'float32x4',
    aGlyphEffectColor: 'uint32x2',
    aGlyphPage: 'float32x4',
  },
  interStage: {
    vGlyphShadowUv: 'vec2<f32>',
    vGlyphUvBounds: 'vec4<f32>',
    vGlyphFillColor: 'vec4<f32>',
    vGlyphOutlineColor: 'vec4<f32>',
    vGlyphShadowColor: 'vec4<f32>',
    vGlyphOutlineWidth: 'f32',
  },
  bindings: {
    material: {
      uGlyphAtlasSize: 'vec2<f32>',
      uGlyphPixelRange: 'f32',
      uGlyphEffectScale: 'vec3<f32>',
    },
  },
  textures: ['glyphMsdfAtlas'],
  gpu: {
    header: msdfWgsl,
    vertex: {
      beforeTransform: `
  position = vec4<f32>(glyphMsdfPosition(input.aGlyphRect.xy, input.aGlyphRect.zw, input.aPosition), 1.0);
`,
      end: `
  uv = glyphMsdfAtlasCoordinate(input.aGlyphUvRect.xy, input.aGlyphUvRect.zw, input.aUV);
  output.vGlyphShadowUv = uv - input.aGlyphPage.xy * material.uGlyphEffectScale.xy;
  output.vGlyphUvBounds = input.aGlyphUvBounds;
  output.vGlyphFillColor = input.aGlyphColor;
  output.vGlyphOutlineColor = glyphDecorationPaint(vec2<u32>(input.aGlyphEffectColor.x, 0u));
  output.vGlyphShadowColor = glyphDecorationPaint(vec2<u32>(input.aGlyphEffectColor.y, 0u));
  output.vGlyphOutlineWidth = input.aGlyphPage.z * material.uGlyphEffectScale.z;
`,
    },
    fragment: {
      material: `
  let glyphCoordinates = glyphMsdfClampedCoordinates(
    input.vUV,
    input.vGlyphShadowUv,
    input.vGlyphUvBounds,
    material.uGlyphAtlasSize
  );
  let glyphPaint = glyphMsdfRender(GlyphMsdfRenderInput(
    input.vUV,
    input.vGlyphShadowUv,
    input.vGlyphUvBounds,
    material.uGlyphAtlasSize,
    material.uGlyphPixelRange,
    sampleGlyphMsdfAtlas(glyphCoordinates.xy),
    sampleGlyphMsdfAtlas(glyphCoordinates.zw),
    input.vGlyphFillColor,
    input.vGlyphOutlineColor,
    input.vGlyphOutlineWidth,
    input.vGlyphShadowColor
  ));
  albedo = glyphPaint.rgb;
  alpha = glyphPaint.a;
`,
    },
  },
  gl: {
    header: msdfGlsl,
    vertex: {
      beforeTransform: `
  position = vec4(glyphMsdfPosition(aGlyphRect.xy, aGlyphRect.zw, aPosition), 1.0);
`,
      end: `
  uv = glyphMsdfAtlasCoordinate(aGlyphUvRect.xy, aGlyphUvRect.zw, aUV);
  vGlyphShadowUv = uv - aGlyphPage.xy * material.uGlyphEffectScale.xy;
  vGlyphUvBounds = aGlyphUvBounds;
  vGlyphFillColor = aGlyphColor;
  vGlyphOutlineColor = glyphDecorationPaint(uvec2(aGlyphEffectColor.x, 0u));
  vGlyphShadowColor = glyphDecorationPaint(uvec2(aGlyphEffectColor.y, 0u));
  vGlyphOutlineWidth = aGlyphPage.z * material.uGlyphEffectScale.z;
`,
    },
    fragment: {
      // Reconstruction takes derivatives, which GLSL ES 3.0 rejects anywhere in a vertex shader.
      header: msdfFragmentGlsl,
      material: `
  vec4 glyphCoordinates = glyphMsdfClampedCoordinates(
    vUV,
    vGlyphShadowUv,
    vGlyphUvBounds,
    material.uGlyphAtlasSize
  );
  vec4 glyphPaint = glyphMsdfRender(GlyphMsdfRenderInput(
    vUV,
    vGlyphShadowUv,
    vGlyphUvBounds,
    material.uGlyphAtlasSize,
    material.uGlyphPixelRange,
    sampleGlyphMsdfAtlas(glyphCoordinates.xy),
    sampleGlyphMsdfAtlas(glyphCoordinates.zw),
    vGlyphFillColor,
    vGlyphOutlineColor,
    vGlyphOutlineWidth,
    vGlyphShadowColor
  ));
  albedo = glyphPaint.rgb;
  alpha = glyphPaint.a;
`,
    },
  },
};
