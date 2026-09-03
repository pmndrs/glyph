import { CatmullRomCurve3, Vector3 } from 'three/webgpu';

/** A closed loop that swings through depth, so the ribbon passes in front of and behind itself. */
export const CURVE = new CatmullRomCurve3(
  // Counter-clockwise seen from above, so the near side runs left to right and reads forward.
  [
    new Vector3(-4.0, -0.9, 0.9),
    new Vector3(-1.2, -1.4, 2.2),
    new Vector3(2.4, -1.7, 1.6),
    new Vector3(4.4, -0.2, -0.6),
    new Vector3(1.8, 1.2, -2.6),
    new Vector3(-1.6, 1.8, -1.8),
    new Vector3(-4.2, 0.6, 0.4),
  ],
  true,
  'centripetal',
);

export const RIBBON = {
  /** The tube's radius; type sits just above it. */
  radius: 0.16,
  /** Units of arc per second the words travel. */
  speed: 0.9,
  size: 0.46,
  letterSpacing: 0.05,
} as const;

/** Whitman, public domain. */
export const LINE = 'I am large, I contain multitudes  ·  ';
