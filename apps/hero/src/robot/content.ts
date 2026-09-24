/** Timeline, in seconds from the start of a run. */
export const ARRIVE_AT = 2.6;
export const LOOK_UP_AT = 2.9;
export const LOOK_DOWN_AT = 5.3;
export const LEAVE_AT = 5.75;
export const RUN_SECONDS = 7.6;
/** Where on its way out the robot counts as gone: this far inside the visible edge, its body just starting to
 * cross it, so the hole is already open by the time it has left. */
export const BODY_REACH = -0.8;
export const COUNT = 128;
export const BASE_Z = 0.12;
export const RISE = 0.8;

export const FACE_TEXT = 'PMNDRS';

/** Along the heading, across it, and up. Shared by the visual rig and its prepared collider. */
export const ROBOT_HALF_EXTENTS: readonly [number, number, number] = [0.68, 1.07, 1.5];
/** How high the robot stands over the paper: its rig and its collider alike. */
export const ROBOT_Z = 0.04;
