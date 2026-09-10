import { CatmullRomCurve3, Vector3 } from 'three/webgpu';

/**
 * An open S-curve across the frame, both ends past its edges, with a little
 * depth so the band tilts as it goes: the ribbon a banner would make.
 */
export const CURVE = new CatmullRomCurve3(
  [
    new Vector3(-9.0, 1.4, 0.7),
    new Vector3(-4.6, -0.6, 1.0),
    new Vector3(-0.8, 1.2, 0.2),
    new Vector3(2.8, -1.1, -0.5),
    new Vector3(6.2, 0.8, -1.2),
    new Vector3(9.6, -0.8, -1.8),
  ],
  false,
  'centripetal',
);

export const RIBBON = {
  /** The band's width; the type lies across it, so it is a little wider than a line is tall. */
  width: 0.86,
  /** A slow sway of the whole ribbon about y, so its depth reads. */
  sway: 0.16,
  /** Units of arc per second the words travel. */
  speed: 1.1,
  size: 0.52,
  letterSpacing: 0.05,
} as const;

/** Whitman, public domain. */
export const LINE = 'I am large, I contain multitudes  ·  ';

/**
 * How many times the line repeats so the shaped text is about as long as the
 * path: the glyphs are placed by advance mapped onto arc length, and a close
 * match keeps that mapping near one so letter spacing reads as authored.
 * Inter's average advance is about half an em.
 */
export const REPEATS = Math.max(
  1,
  Math.round(CURVE.getLength() / (LINE.length * (RIBBON.size * 0.52 + RIBBON.letterSpacing))),
);
