/** Shared bake and load settings for the feature line's MSDF outline. */
export const FEATURE_FIELD = { emSize: 64, pixelRange: 24 } as const;

export const FEATURE_LINE = 'SHAPING · LAYOUT · BAKING · SHADERS · SLUG · MSDF · BITMAP · WEBGPU';

/** The title's five stained-glass tints, one a letter. The rest of the hero borrows them for its accents. */
export const THEME_TINTS = ['#ff4980', '#ffc043', '#00f7a3', '#2bdcf6', '#d855f9'] as const;
/** The title's red, on the G. */
export const THEME_RED = THEME_TINTS[0];
