import type { ShaderBit } from '@pixi/3d';
import { decorationGlsl, decorationWgsl } from './generated/shaders.js';

/** Resource-free solid decoration paint decoded by Glyph's shared shader authority. */
export const glyphDecorationBit: ShaderBit = {
  name: 'pmndrsGlyphDecoration',
  attributes: { aGlyphDecoration: 'uint32x2' },
  interStage: { vGlyphDecorationColor: 'vec4<f32>' },
  gpu: {
    header: decorationWgsl,
    vertex: { end: 'output.vGlyphDecorationColor = glyphDecorationPaint(input.aGlyphDecoration);' },
    fragment: { material: 'albedo = input.vGlyphDecorationColor.rgb; alpha = input.vGlyphDecorationColor.a;' },
  },
  gl: {
    header: decorationGlsl,
    vertex: { end: 'vGlyphDecorationColor = glyphDecorationPaint(aGlyphDecoration);' },
    fragment: { material: 'albedo = vGlyphDecorationColor.rgb; alpha = vGlyphDecorationColor.a;' },
  },
};
