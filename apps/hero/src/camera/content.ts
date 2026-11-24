/**
 * The shots. Positions are world units: the page is centred on the origin facing +z, y up. A shot is where the
 * camera stands, what it looks at, its lens, how wide its aperture is for the depth of field, and how much a hand
 * is holding it. `follow` shots take their subject from the scene each frame and add these as offsets.
 */
export interface ShotPlan {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly fov: number;
  /** 0 = everything sharp. */
  readonly aperture: number;
  /** Handheld: position sway in world units and rotation in degrees. */
  readonly sway: number;
  readonly shake: number;
  /** Seconds the camera takes to catch up with a subject that moves. */
  readonly lag: number;
}

export type ShotName = 'caret' | 'crane' | 'columns' | 'stone' | 'edit' | 'dive' | 'free';

export const SHOTS: Readonly<Record<ShotName, ShotPlan>> = {
  // Low over the headline, trailing the caret as it types, close enough that the caret is the only light.
  caret: {
    position: [0.4, -5.2, 8.6],
    target: [-1.7, -0.2, 0],
    fov: 30,
    aperture: 1,
    sway: 0.035,
    shake: 0.18,
    lag: 0.9,
  },
  // The crane's top: the whole spread, tilted away.
  crane: { position: [0.6, -15.5, 43], target: [0, -1, 0], fov: 33, aperture: 0.55, sway: 0.08, shake: 0.1, lag: 0 },
  // Over the columns while the gutters are pulled.
  columns: {
    position: [-4.2, -10.5, 25.5],
    target: [-4, -3.6, 0],
    fov: 32,
    aperture: 0.6,
    sway: 0.06,
    shake: 0.12,
    lag: 0,
  },
  // Riding with the stone.
  stone: {
    position: [1.2, -7.2, 13.5],
    target: [0, 0.3, 0],
    fov: 32,
    aperture: 0.9,
    sway: 0.07,
    shake: 0.2,
    lag: 0.55,
  },
  // Over the caret's shoulder.
  edit: { position: [1.1, -3.6, 6.2], target: [0.9, 0, 0], fov: 28, aperture: 1.1, sway: 0.03, shake: 0.14, lag: 0.7 },
  // The dive is placed by its own progress. This is where it begins.
  dive: { position: [0, -2.2, 9], target: [0, 0, 0], fov: 30, aperture: 1, sway: 0.01, shake: 0.05, lag: 0 },
  // The visitor's own view: the spread, leaning a little with the pointer.
  free: { position: [0.3, -14, 41.5], target: [0, -0.9, 0], fov: 33, aperture: 0.35, sway: 0.05, shake: 0.06, lag: 0 },
};

/** How far the free shot leans with the pointer, in world units. */
export const FREE_LEAN = 1.6;
/** Seconds for the attract loop's dive, start to through. */
export const DIVE_SECONDS = 9.5;
