import { uniform } from 'three/tsl';
import { Vector2 } from 'three/webgpu';

/** Scene seconds from the director: slows with the impact, never reverses. */
export const uTime = uniform(0);
/** 1 = idle float; eased toward 0 while physics owns the glyphs so shader drift cannot fight the colliders. */
export const uFloat = uniform(1);
/** Glitch intensity from the director's cut envelope. */
export const uCut = uniform(0);
/** Depth-of-field focus distance from the camera, in world units. */
export const uFocus = uniform(12);
/** Motion-blur weight: 1 while physics runs, 0 otherwise. */
export const uMotion = uniform(0);

/** How far the paper grain has drifted, in its own plane units. The ground moves with the icon field: a static
 * texture under a scrolling pattern reads as a mistake. */
export const uPaperDrift = uniform(new Vector2(0, 0));
