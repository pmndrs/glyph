/**
 * The shot is fixed: no orbiting, no framing that moves. Everything the lens needs is decided here so the floor,
 * the depth of field, and the robot's entrance all measure themselves against the same camera.
 *
 * The world is z-up and the floor is the xy plane, which keeps the robot's rig and its wheels in one frame.
 */
export const CAMERA = {
  /** Raised above the robot's head and set back to its right, on a long lens. */
  position: [1.8, -8.08, 4.2],
  /** Aimed at its chest, so the frame holds the whole robot with the face high in it. */
  target: [0, 0.4, 1.62],
  /** Vertical field of view, in degrees. Long enough to compress the floor into a wall of bokeh behind it. */
  fov: 22,
  /** A slight roll, counter to the robot's travel, so the frame is not perfectly level. */
  roll: -0.05,
  near: 0.5,
  far: 260,
} as const;

/** Where the robot stops, on the floor. */
export const MARK: readonly [x: number, y: number] = [CAMERA.target[0], CAMERA.target[1]];

/** How high the robot's display sits above the floor when it is turned to the lens. */
export const FACE_HEIGHT = 2.36;

/**
 * The lens focuses on the face at the mark, not on the point it is aimed at, and holds barely half a metre of
 * the world either side of it. Everything else, which is the whole floor, is thrown away.
 */
export const FOCUS_DISTANCE = Math.hypot(
  MARK[0] - CAMERA.position[0],
  MARK[1] - CAMERA.position[1],
  FACE_HEIGHT - CAMERA.position[2],
);
export const FOCAL_LENGTH = 0.5;
export const BOKEH_SCALE = 7;

/** Half the frame's height on the floor at the mark. */
export const HALF_FRAME_HEIGHT = Math.tan((CAMERA.fov / 2) * (Math.PI / 180)) * FOCUS_DISTANCE;

/** The lens's own basis, which is what turns a floor point into a position in the frame. */
const FORWARD = unit([
  CAMERA.target[0] - CAMERA.position[0],
  CAMERA.target[1] - CAMERA.position[1],
  CAMERA.target[2] - CAMERA.position[2],
]);
const SIDE = unit([FORWARD[1], -FORWARD[0], 0]);
const TAN_HALF_FOV = Math.tan((CAMERA.fov / 2) * (Math.PI / 180));

/** Screen right, projected onto the floor. */
const SCREEN_RIGHT = Math.atan2(SIDE[1], SIDE[0]);

/**
 * How far the travel line is turned off screen right. A wide turn is the point: the robot comes in from deep
 * behind the mark and crosses towards the lens on a diagonal, so it arrives out of the blur rather than sliding
 * in flat from the side.
 */
export const TRAVEL_SKEW = 0.6;
export const TRAVEL_HEADING = SCREEN_RIGHT - TRAVEL_SKEW;

/** Bearing from a floor point to the lens: where the robot looks when it looks into the camera. */
export function bearingToCamera(x: number, y: number): number {
  return Math.atan2(CAMERA.position[1] - y, CAMERA.position[0] - x);
}

/**
 * Where a floor point falls across the frame, as a fraction of half its width. Past one, either way, the point is
 * outside the picture. The frame widens with depth, so a point far behind the mark may still be in it.
 */
export function framePosition(x: number, y: number, aspect: number): number {
  const to: readonly [number, number, number] = [x - CAMERA.position[0], y - CAMERA.position[1], -CAMERA.position[2]];
  const depth = dot(to, FORWARD);

  if (depth <= CAMERA.near) return Number.POSITIVE_INFINITY;

  return dot(to, SIDE) / (depth * TAN_HALF_FOV * aspect);
}

/**
 * How far along the travel line the robot must be to sit outside a frame `aspect` wide, plus its own length. The
 * two ends are measured and the longer one taken, so one distance serves both and the entry, which is the deeper
 * and therefore wider end, is the one that decides it.
 */
export function offFrameDistance(aspect: number): number {
  return Math.max(edgeDistance(aspect, -1), edgeDistance(aspect, 1)) + 2.2;
}

/** The nearest distance along the travel line, in `sign`'s direction, at which the mark's line leaves the frame. */
function edgeDistance(aspect: number, sign: number): number {
  const cos = Math.cos(TRAVEL_HEADING) * sign;
  const sin = Math.sin(TRAVEL_HEADING) * sign;
  const outside = (distance: number) =>
    Math.abs(framePosition(MARK[0] + cos * distance, MARK[1] + sin * distance, aspect)) >= 1;
  let inside = 0;
  let beyond = 4;

  while (beyond < 512 && !outside(beyond)) beyond *= 2;

  for (let step = 0; step < 24; step++) {
    const middle = (inside + beyond) / 2;

    if (outside(middle)) beyond = middle;
    else inside = middle;
  }

  return beyond;
}

function dot(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function unit(v: readonly [number, number, number]): readonly [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]);

  return [v[0] / length, v[1] / length, v[2] / length];
}
