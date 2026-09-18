import { clamp } from 'math';
import { easing } from 'math/time';

/** Where it stops to look up: on top of the title, over the Y. The path is laid through this point. */
const STOP: readonly [x: number, y: number] = [-0.4, 0.3];
/** Direction of travel, from the x axis: up and to the right, steeper than the icon drift so the two read apart. */
const HEADING = 0.62;
const HEADING_COS = Math.cos(HEADING);
const HEADING_SIN = Math.sin(HEADING);
/** How far past the visible edge it starts and ends, so it never pops into view; covers the meander too. */
const EDGE_MARGIN = 2.6;
/**
 * The meander: two sine waves across the line of travel, so the drive curves instead of ruling a straight line,
 * and the heading turns with it. Phase advances every run, so no two crossings take the same path.
 */
const MEANDER = [
  { amplitude: 0.7, frequency: (2 * Math.PI) / 9.5 },
  { amplitude: 0.22, frequency: (2 * Math.PI) / 3.1 },
] as const;
const PHASE_STEP = 2.4;

/** Seconds after the page loads before the first run, and after the title lands before a replay's run. */
export const FIRST_RUN_DELAY = 1.6;
export const REPLAY_DELAY = 1.4;
/** Timeline, in seconds from the start of a run. */
const ARRIVE_AT = 2.6;
export const LOOK_UP_AT = 2.9;
const LOOK_UP_SECONDS = 0.55;
export const LOOK_DOWN_AT = 5.3;
const LOOK_DOWN_SECONDS = 0.4;
export const LEAVE_AT = 5.75;
export const RUN_SECONDS = 7.6;
/** Where on its way out the robot counts as gone: this far inside the visible edge, its body just starting to
 * cross it, so the hole is already open by the time it has left. */
export const BODY_REACH = -0.8;
interface Path {
  /** Arc length from the start to the stop, and from the stop to the exit. */
  inward: number;
  outward: number;
  phase: number;
}

interface Pose {
  x: number;
  y: number;
  /** Direction of travel at this point, from the x axis. */
  heading: number;
  /** 0 = looking ahead along the path, 1 = face turned up to the camera. */
  look: number;
}

/** Lays the run through STOP so it starts and ends past the visible edge of a `width` by `height` floor. */
export function layPath(out: Path, width: number, height: number, run: number): Path {
  const [stopX, stopY] = STOP;
  const cos = HEADING_COS;
  const sin = HEADING_SIN;
  // In from beyond both the left and the bottom edge; out once beyond the right or the top edge.
  const inward = Math.max((stopX + width / 2 + EDGE_MARGIN) / cos, (stopY + height / 2 + EDGE_MARGIN) / sin);
  const outward = Math.min((width / 2 + EDGE_MARGIN - stopX) / cos, (height / 2 + EDGE_MARGIN - stopY) / sin);
  out.inward = inward;
  out.outward = outward;
  out.phase = run * PHASE_STEP;
  return out;
}

/** Where the robot is `time` seconds into a run along `path`. */
export function poseAt(out: Pose, time: number, path: Path): Pose {
  // Arc length along the line of travel, measured from the stop.
  let s: number;
  if (time < ARRIVE_AT) s = -path.inward * (1 - easing.cubicOut(time / ARRIVE_AT));
  else if (time < LEAVE_AT) s = 0;
  else s = path.outward * easing.cubicIn(saturate((time - LEAVE_AT) / (RUN_SECONDS - LEAVE_AT)));

  let offset = 0;
  let slope = 0;
  for (let index = 0; index < MEANDER.length; index++) {
    const wave = MEANDER[index]!;
    const k = wave.frequency;
    const shift = path.phase * (index + 1);
    offset += wave.amplitude * (Math.sin(k * s + shift) - Math.sin(shift));
    slope += wave.amplitude * k * Math.cos(k * s + shift);
  }
  const cos = HEADING_COS;
  const sin = HEADING_SIN;
  const x = STOP[0] + cos * s - sin * offset;
  const y = STOP[1] + sin * s + cos * offset;

  let look: number;
  if (time < LOOK_UP_AT) look = 0;
  else if (time < LOOK_DOWN_AT) look = easing.sineInOut(saturate((time - LOOK_UP_AT) / LOOK_UP_SECONDS));
  else look = 1 - easing.sineInOut(saturate((time - LOOK_DOWN_AT) / LOOK_DOWN_SECONDS));
  out.x = x;
  out.y = y;
  out.heading = HEADING + Math.atan(slope);
  out.look = look;
  return out;
}

export function createRobotMotion() {
  return { path: { inward: 0, outward: 0, phase: 0 }, pose: { x: 0, y: 0, heading: 0, look: 0 } };
}
function saturate(value: number): number {
  return clamp(value, 0, 1);
}
