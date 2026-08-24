export interface GlyphExampleShaderBuffer {
  readonly id: number;
  readonly scalar: 'f32';
  readonly vectorWidth: number;
}

export interface GlyphExampleShaderContract {
  readonly techniqueId: 'studio.glyph-example';
  readonly geometry: 'synthetic-quad';
  readonly buffers: Readonly<{
    readonly origin: GlyphExampleShaderBuffer;
    readonly size: GlyphExampleShaderBuffer;
    readonly color: GlyphExampleShaderBuffer;
  }>;
  readonly resource: 'glyphColors';
}

export const glyphExampleShaderContract: GlyphExampleShaderContract = Object.freeze({
  techniqueId: 'studio.glyph-example',
  geometry: 'synthetic-quad',
  buffers: Object.freeze({
    origin: Object.freeze({ id: 1, scalar: 'f32' as const, vectorWidth: 2 }),
    size: Object.freeze({ id: 2, scalar: 'f32' as const, vectorWidth: 2 }),
    color: Object.freeze({ id: 3, scalar: 'f32' as const, vectorWidth: 4 }),
  }),
  resource: 'glyphColors' as const,
});

export interface GlyphExampleShaderVariant {
  readonly language: 'typegpu' | 'tsl';
  readonly techniqueId: GlyphExampleShaderContract['techniqueId'];
  readonly geometry: typeof glyphExampleShaderContract.geometry;
  readonly buffers: typeof glyphExampleShaderContract.buffers;
  readonly resource: typeof glyphExampleShaderContract.resource;
}
