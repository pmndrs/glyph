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

function linearToSrgb(channel: number): number {
  return channel <= 0.003_130_8 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
}

/** Björn Ottosson's OKLab → linear sRGB matrix, then the transfer function and a hex string. */
function oklch(lightness: number, chroma: number, hueDegrees: number): string {
  const hue = (hueDegrees * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const long = (lightness + 0.396_337_777_4 * a + 0.215_803_757_3 * b) ** 3;
  const medium = (lightness - 0.105_561_345_8 * a - 0.063_854_172_8 * b) ** 3;
  const short = (lightness - 0.089_484_177_5 * a - 1.291_485_548 * b) ** 3;
  const channels = [
    4.076_741_662_1 * long - 3.307_711_591_3 * medium + 0.230_969_929_2 * short,
    -1.268_438_004_6 * long + 2.609_757_401_1 * medium - 0.341_319_396_5 * short,
    -0.004_196_086_3 * long - 0.703_418_614_7 * medium + 1.707_614_701 * short,
  ];
  const hex = channels
    .map((channel) =>
      Math.round(Math.min(Math.max(linearToSrgb(channel), 0), 1) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');

  return `#${hex}`;
}

/** Hue rotations in OKLab hold lightness and chroma constant across the deep icon sheet. */
export const GEM_TONES: readonly string[] = [25, 75, 145, 195, 255, 310].map((hue) => oklch(0.7464, 0.105, hue));

/** Scroll direction, as an angle from the x axis. Both layers share it, so the paper moves as one. */
export const PATTERN_ANGLE = -0.32;
/** How long one flip takes, and the window over which a motif's cells start theirs. */
export const MORPH_SECONDS = 0.32;
export const STAGGER_SECONDS = 0.5;
/** Quantized start times spread each motif flip across the sheet. */
export const STAGGER_STEPS = 5;

/** The canvas camera's vertical field of view, for projecting the pointer onto a layer. */
export const FIELD_OF_VIEW = 35;

export const GLYPHS = Object.values(ICON_CODE_POINTS).map((point) => String.fromCodePoint(point));
