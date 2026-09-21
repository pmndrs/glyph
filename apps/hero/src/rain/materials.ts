import { createStainedGlass } from '../letters/materials';
import { THEME_TINTS } from '../letters/content';

/** One pane of glass a theme tint, shared by every glyph of that tint. */
export const rainGlass = THEME_TINTS.map((tint, index) => createStainedGlass(`rain-glass-${index}`, tint));
