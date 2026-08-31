import { describe, expect, it } from 'vitest';

import { beginGlyphRender, completeGlyphRender, type GlyphRenderReadiness } from './glyph-render-readiness';

describe('glyph render readiness', () => {
  it('hides a slot for a scene replacement until the current render is ready', () => {
    const state: GlyphRenderReadiness = { ready: true, renderToken: 4 };
    const staleToken = beginGlyphRender(state);
    const currentToken = beginGlyphRender(state);

    expect(state.ready).toBe(false);
    expect(completeGlyphRender(state, staleToken)).toBe(false);
    expect(state.ready).toBe(false);
    expect(completeGlyphRender(state, currentToken)).toBe(true);
    expect(state.ready).toBe(true);
  });
});
