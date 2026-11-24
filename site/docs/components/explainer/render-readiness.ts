export type GlyphRenderReadiness = {
  ready: boolean;
  renderToken: number;
};

/** Begin a scene replacement and wait for its current Suspense tree. */
export function beginGlyphRender(state: GlyphRenderReadiness) {
  const token = ++state.renderToken;
  state.ready = false;
  return token;
}

/** Ignore readiness callbacks from an older render tree. */
export function completeGlyphRender(state: GlyphRenderReadiness, token: number) {
  if (token !== state.renderToken) return false;
  state.ready = true;
  return true;
}
