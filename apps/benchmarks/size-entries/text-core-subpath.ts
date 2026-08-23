// `/core` is deliberately unpublished until the TypeGPU backend proves its shape (D-267), so this
// entry weighs the built module directly rather than through an `exports` subpath. The measurement
// is what the gate needs: the same module graph a consumer would pull if the layer were published.
export * from '../../../packages/glyph/dist/core.js';
