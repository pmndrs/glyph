/** Latin and Arabic subset of Amiri in the Slug format, baked by site/scripts/bake-editing-fonts.mts. */
export const AMIRI = new URL('../../../../docs/assets/fonts/editing/amiri-bidi.font.glb', import.meta.url).href;
/** abc, a space, four Arabic letters (offsets 4 to 8, drawn right to left), a space, def. */
export const PASSAGE = 'abc سلام def';
/** Where the left-to-right run ends and the right-to-left run starts. */
export const BOUNDARY = 4;
export const FONT_SIZE = 1;
