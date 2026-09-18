/** Every word on screen, its face, and where it floats. The bake script derives font subsets from this file. */

export type FaceId =
  | 'geist-black'
  | 'noto-cjk-words'
  | 'amiri-bold'
  | 'devanagari-bold'
  | 'geist-medium'
  | 'geist-mono-bold'
  | 'geist-pixel-grid'
  | 'source-serif'
  | 'dancing-script'
  | 'dotgothic'
  | 'amiri'
  | 'devanagari'
  | 'cjk';

export type IconName =
  | 'ankh'
  | 'yin-yang'
  | 'bahai'
  | 'dharmachakra'
  | 'om'
  | 'hamsa'
  | 'khanda'
  | 'atom'
  | 'skull'
  | 'eye'
  | 'crow';

/** Font Awesome Free Solid 6.7.2 code points, from `benches/fixtures/fonts/font-awesome-free-6.7.2/icons.json`. */
export const ICON_CODE_POINTS: Readonly<Record<IconName, number>> = {
  ankh: 0xf644,
  'yin-yang': 0xf6ad,
  bahai: 0xf666,
  dharmachakra: 0xf655,
  om: 0xf679,
  hamsa: 0xf665,
  khanda: 0xf66d,
  atom: 0xf5d2,
  skull: 0xf54c,
  eye: 0xf06e,
  crow: 0xf520,
};

export type Vec3 = readonly [x: number, y: number, z: number];

export const TITLE = { text: 'Glyph', face: 'geist-black', fontSize: 2.6, position: [0, 0.55, 0] } as const;

/**
 * The closing beat: one line of features, typed out, separated by a middle dot (U+00B7). The dot sits outside Basic
 * Latin, so the bake script scans this line to pick it up — changing the copy changes the subset.
 */
/**
 * The feature line's MSDF field, baked and declared from this one place. The raster's identity includes these two
 * numbers: bake at one pair and load at another and the face does not match its own baked raster, so the runtime
 * tries to bake the font itself instead of using the asset. The default is 64/8, which encodes only +/-0.0625em —
 * too little for the outline the line needs.
 */
export const FEATURE_FIELD = { emSize: 64, pixelRange: 24 } as const;

export const FEATURE_LINE = {
  text: 'SHAPING \u00b7 LAYOUT \u00b7 BAKING \u00b7 SHADERS \u00b7 SLUG \u00b7 MSDF \u00b7 BITMAP \u00b7 WEBGPU',
  face: 'geist-mono-bold',
} as const satisfies { text: string; face: FaceId };

export const HEADLINE = {
  text: 'Real text. Real 3D. Every Canvas.',
  face: 'geist-medium',
  fontSize: 0.36,
  position: [0, -0.95, 0],
} as const satisfies { text: string; face: FaceId; fontSize: number; position: Vec3 };

export interface BackgroundWord {
  readonly text?: string;
  readonly face?: FaceId;
  readonly icon?: IconName;
  readonly fontSize: number;
  readonly position: Vec3;
  /** Rotation about Z in radians. */
  readonly roll: number;
}

/** A fixed layout so every run (and every recording) starts from the same scene. */
export const BACKGROUND_WORDS: readonly BackgroundWord[] = [
  { text: 'Paragraph layout', face: 'source-serif', fontSize: 0.9, position: [-6.2, 3.1, -7], roll: 0.06 },
  {
    text: 'Unicode shaping',
    face: 'source-serif',
    icon: 'eye',
    fontSize: 0.8,
    position: [5.8, -3.2, -9],
    roll: -0.05,
  },
  { text: 'Bitmap · MSDF · Slug', face: 'geist-mono-bold', fontSize: 0.7, position: [4.9, 3.6, -11], roll: -0.04 },
  {
    text: 'TypeGPU',
    face: 'geist-mono-bold',
    icon: 'atom',
    fontSize: 1.1,
    position: [-8.4, -2.4, -12],
    roll: 0.08,
  },
  { text: 'WebGPU', face: 'geist-pixel-grid', icon: 'skull', fontSize: 1.4, position: [8.6, 0.6, -14], roll: 0.03 },
  {
    text: 'Batched draws',
    face: 'geist-pixel-grid',
    icon: 'bahai',
    fontSize: 0.9,
    position: [-3.4, -4.6, -10],
    roll: -0.07,
  },
  {
    text: 'React Three Fiber',
    face: 'geist-medium',
    icon: 'ankh',
    fontSize: 0.8,
    position: [1.2, 5.2, -15],
    roll: 0.02,
  },
  {
    text: 'Zero DOM',
    face: 'dancing-script',
    fontSize: 1.3,
    position: [-9.5, 1.4, -16],
    roll: -0.1,
  },
  { text: 'Pixel perfect', face: 'dotgothic', fontSize: 0.9, position: [3.6, -5.8, -13], roll: 0.05 },
  { text: 'العربية', face: 'amiri', fontSize: 1.5, position: [-4.8, 0.2, -8], roll: 0.04 },
  { text: 'देवनागरी', face: 'devanagari', fontSize: 1.1, position: [7.2, -1.4, -6.5], roll: -0.06 },
  { text: '日本語', face: 'cjk', fontSize: 1.6, position: [-1.6, -2.9, -17], roll: 0.03 },
  // Behind the glass title, so it always has words to refract.
  { text: 'Kerning', face: 'geist-mono-bold', fontSize: 1.1, position: [-2.6, 1.3, -5], roll: -0.05 },
  { text: 'Ligatures', face: 'dancing-script', fontSize: 1.5, position: [2.8, 0.2, -6], roll: 0.07 },
  { text: 'Line breaking', face: 'source-serif', fontSize: 0.9, position: [0.4, 2.3, -8], roll: 0.03 },
  { text: 'SUBPIXEL', face: 'geist-pixel-grid', fontSize: 1.2, position: [-3.8, -0.2, -9.5], roll: 0.05 },
  { text: 'Baselines', face: 'dotgothic', fontSize: 1.0, position: [4.2, 1.9, -11], roll: -0.08 },
  { text: 'Bidi', face: 'geist-medium', icon: 'khanda', fontSize: 1.3, position: [-0.6, -0.6, -12.5], roll: -0.03 },
  { icon: 'bahai', fontSize: 1.2, position: [-7.1, 4.6, -18], roll: 0.2 },
  { icon: 'yin-yang', fontSize: 1.0, position: [9.4, 4.4, -17], roll: -0.3 },
  { icon: 'khanda', fontSize: 1.1, position: [-10.2, -4.9, -15], roll: 0.1 },
  { icon: 'om', fontSize: 1.0, position: [10.4, -4.2, -12], roll: -0.15 },
];
