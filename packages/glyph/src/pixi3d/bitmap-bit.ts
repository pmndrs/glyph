import type { ShaderBit } from '@pixi/3d';

import { bitmapGlsl, bitmapWgsl } from './generated/shaders.js';

/** Pixi-owned attributes and texture access around Glyph's generated TypeGPU Bitmap math. */
export const glyphBitmapBit: ShaderBit = {
  name: 'pmndrsGlyphBitmapTypeGpu',
  attributes: {
    aGlyphOrigin: 'float32x2',
    aGlyphSize: 'float32x2',
    aGlyphUvOrigin: 'float32x2',
    aGlyphUvSize: 'float32x2',
    aGlyphColor: 'float32x4',
  },
  interStage: {
    vGlyphColor: 'vec4<f32>',
  },
  textures: ['glyphBitmapAtlas'],
  gpu: {
    header: bitmapWgsl,
    vertex: {
      beforeTransform: `
  position = vec4<f32>(glyphBitmapQuadPosition(input.aGlyphOrigin, input.aGlyphSize, input.aPosition.xy), 1.0);
`,
      end: `
  uv = glyphBitmapAtlasUv(input.aGlyphUvOrigin, input.aGlyphUvSize, input.aUV);
  output.vGlyphColor = input.aGlyphColor;
`,
    },
    fragment: {
      material: `
  let glyphPaint = glyphBitmapPaintCoverageOpacity(sampleGlyphBitmapAtlas(input.vUV).r, input.vGlyphColor);
  albedo = input.vGlyphColor.rgb;
  alpha = glyphPaint.y;
`,
    },
  },
  gl: {
    header: bitmapGlsl,
    vertex: {
      beforeTransform: `
  position = vec4(glyphBitmapQuadPosition(aGlyphOrigin, aGlyphSize, aPosition.xy), 1.0);
`,
      end: `
  uv = glyphBitmapAtlasUv(aGlyphUvOrigin, aGlyphUvSize, aUV);
  vGlyphColor = aGlyphColor;
`,
    },
    fragment: {
      material: `
  vec2 glyphPaint = glyphBitmapPaintCoverageOpacity(sampleGlyphBitmapAtlas(vUV).r, vGlyphColor);
  albedo = vGlyphColor.rgb;
  alpha = glyphPaint.y;
`,
    },
  },
};
