/**
 * A one-glyph Inter subset holding U+2026. `overflow: 'ellipsis'` shapes that
 * character through the paragraph's font stack, and the shared Inter subset is
 * Basic Latin only. Baked by `site/scripts/bake-layout-fonts.mts`.
 */
export const ELLIPSIS = new URL('../../../../docs/assets/fonts/layout/inter-ellipsis.font.glb', import.meta.url).href;
/** Must match the bake script. */
export const ELLIPSIS_MSDF = { emSize: 32, pixelRange: 6 } as const;
