import { trait } from 'koota';

/** Seconds since emission. Negative while waiting. */
export const StarEmbers = trait({ age: -1 });

export const EMBER_SECONDS = 1.25;

/** Unicode star shapes shared by the renderer and its baked font subset. */
export const STAR_SYMBOLS = ['★', '☆', '✦', '✧', '✩', '✶'] as const;
