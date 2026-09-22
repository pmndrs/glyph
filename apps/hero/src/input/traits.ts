import { trait } from 'koota';

export const Keys = trait(() => new Set<string>());
/** Where the pointer is, whether it is over the canvas at all, and how recently it moved, fading to 0 at rest. */
export const Pointer = trait({ x: 0, y: 0, present: false, strength: 0 });
