import { clamp } from 'math';

/** Downward acceleration in px/s². */
export const GRAVITY = 2200;
export const FONT_SIZE = 56;
/** How long a hand keeps a letter before tossing it to the other hand. */
export const DWELL = 0.16;
/** Horizontal distance from the body's centre line to each hand's outer catching position. */
export const HAND_OFFSET_X = 46;

export type Side = 'left' | 'right';

/** Fixed body landmarks for the current view height, in pixels with +Y up and the origin at the view centre. */
export interface Figure {
  readonly floorY: number;
  readonly hipY: number;
  readonly shoulderY: number;
  readonly headY: number;
  readonly headRadius: number;
  /** Height of the hands at rest, which is also the plane every letter is caught on. */
  readonly catchY: number;
  /** Top of the typed sentence. */
  readonly topY: number;
}

export function figure(height: number): Figure {
  const floorY = -height / 2 + 36;
  const shoulderY = floorY + 124;

  return {
    floorY,
    hipY: floorY + 66,
    shoulderY,
    headY: floorY + 150,
    headRadius: 15,
    catchY: shoulderY - 34,
    topY: height / 2 - 72,
  };
}

export function handOffsetX(side: Side): number {
  return side === 'left' ? -HAND_OFFSET_X : HAND_OFFSET_X;
}

export function opposite(side: Side): Side {
  return side === 'left' ? 'right' : 'left';
}

/** Seconds until a body at `y` moving at `vy` falls to `planeY`; zero when it is already at or below it. */
export function timeToPlane(y: number, vy: number, planeY: number): number {
  if (y <= planeY) return 0;

  return (vy + Math.sqrt(vy * vy + 2 * GRAVITY * (y - planeY))) / GRAVITY;
}

/**
 * Flight time for a toss. Each hand must clear its dwell before the next letter arrives, so more letters in play
 * means higher throws, capped so the apex stays inside the view.
 */
export function flightTime(inPlay: number, height: number): number {
  const body = figure(height);
  const longest = Math.sqrt((8 * (body.topY - body.catchY - FONT_SIZE)) / GRAVITY);
  const needed = 0.6 + DWELL * Math.max(0, inPlay / 2 - 1) * 1.6;

  return clamp(needed, Math.min(1, longest), longest);
}

/**
 * Two-bone inverse kinematics: writes the middle joint of two equal segments joining `a` to `b` into `out`, bending
 * toward the preferred direction. When the target is out of reach the joint sits on the line and the limb stretches.
 */
export function bend(
  out: [number, number],
  ax: number,
  ay: number,
  bx: number,
  by: number,
  segment: number,
  preferX: number,
  preferY: number,
): [number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const distance = Math.hypot(dx, dy);
  const midX = (ax + bx) / 2;
  const midY = (ay + by) / 2;

  if (distance >= 2 * segment || distance === 0) {
    out[0] = midX;
    out[1] = midY;

    return out;
  }

  const height = Math.sqrt(segment * segment - (distance / 2) * (distance / 2));
  const px = (-dy / distance) * height;
  const py = (dx / distance) * height;
  const toward = px * preferX + py * preferY >= 0 ? 1 : -1;
  out[0] = midX + px * toward;
  out[1] = midY + py * toward;

  return out;
}
