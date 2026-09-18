import { HOLE_CENTER, HORIZON } from './motion';
import { uniform } from 'three/tsl';
import { Vector2 } from 'three/webgpu';

/** Playback seconds from the scene world, held at zero until preparation completes. */
export const uTime = uniform(0);
/** Shared with the glyph shaders: where the hole is, how far it reaches, how hard it bends, and how it spins. */
export const uHoleCenter = uniform(new Vector2(HOLE_CENTER[0], HOLE_CENTER[1]));
export const uHoleHorizon = uniform(HORIZON);
/** 0 = no warp; 1 = the full spiral. */
export const uHoleBend = uniform(0);
/** Accumulated spin of the accretion disk and the warp's drag, in radians. */
export const uHoleSpin = uniform(0);
/** 0..1: how much of the frame is black. */
export const uHoleBlackout = uniform(0);
/** The camera's height over the floor: a glyph deeper down needs a wider reach to look the same size on screen. */
export const uHoleCamera = uniform(16);
/** The whole rendered sheet winds into the centre, exposing black behind its edges. */
export const uHoleCollapse = uniform(0);
/** Seconds since the explosion; negative before it. */
export const uHoleBurst = uniform(-1);
/** Extra soft bloom while the star sparks are the only visible objects. */
export const uHoleBloom = uniform(0.18);
export const uHoleShake = uniform(new Vector2());
