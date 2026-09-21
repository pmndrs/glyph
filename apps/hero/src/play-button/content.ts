/**
 * The button sits on its own screen-space sheet: y spans -1..1 top to bottom, and x spans the same scale across,
 * so it is drawn and hit in the same units the pointer arrives in.
 */
export const BUTTON_WIDTH = 1.16;
export const BUTTON_HEIGHT = 0.44;
export const BUTTON_RADIUS = 0.1;
/** Room around the frame on its plane for the halo to fade out, so the plane's square edge never shows. */
export const FRAME_MARGIN = 0.06;
export const LABEL = 'Play';
export const LABEL_SIZE = 0.22;
/** The button's pixel: two of the pixel font's squares, which sit 38 thousandths of an em apart. */
export const PIXEL = LABEL_SIZE * 0.076;
/** Seconds after the embers go out before the button starts to draw, and how long it takes. */
export const REVEAL_AFTER = 0.35;
export const REVEAL_SECONDS = 0.9;
