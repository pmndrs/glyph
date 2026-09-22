/** Shared bake and load settings for the feature line's MSDF outline. */
export const FEATURE_FIELD = { emSize: 64, pixelRange: 24 } as const;

export const FEATURE_LINE = 'SHAPING · LAYOUT · BAKING · SHADERS · SLUG · MSDF · BITMAP · WEBGPU';

/** The title's five stained-glass tints, one a letter. The rest of the hero borrows them for its accents. */
export const THEME_TINTS = ['#ff4980', '#ffc043', '#00f7a3', '#2bdcf6', '#d855f9'] as const;
/** The title's red, on the G. */
export const THEME_RED = THEME_TINTS[0];

/** The lamp the title's shadows are cast from, above and to the upper right, and the plane they fall on. */
export const SHADOW_LAMP = [4, 6, 24] as const;
export const SHADOW_RECEIVER_Z = -0.06;
/** Objects on this layer cast in the glass projection as opaque casters, drawn under its lamp with an override. */
export const SHADOW_CASTER_LAYER = 2;
