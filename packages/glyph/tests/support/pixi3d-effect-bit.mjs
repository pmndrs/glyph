/** A per-glyph effect recipe: reads the Glyph effect lane in the vertex stage and a material field in the fragment. */
export const testEffectBit = {
  name: 'testGlyphEffect',
  attributes: { aGlyphEffect: 'float32x2' },
  interStage: { vGlyphTestEffect: 'vec2<f32>' },
  bindings: { material: { uGlyphTestImpact: 'f32' } },
  gpu: {
    vertex: { end: 'output.vGlyphTestEffect = input.aGlyphEffect;' },
    fragment: { lighting: 'alpha *= 1.0 - material.uGlyphTestImpact * input.vGlyphTestEffect.y;' },
  },
  gl: {
    vertex: { end: 'vGlyphTestEffect = aGlyphEffect;' },
    fragment: { lighting: 'alpha *= 1.0 - material.uGlyphTestImpact * vGlyphTestEffect.y;' },
  },
};
