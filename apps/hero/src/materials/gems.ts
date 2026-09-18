/**
 * Gem tones for the deep icon sheet, generated in OKLab so they are hue rotations of one another at a fixed
 * lightness and chroma. Picking them by eye in sRGB would make some read heavier than others; holding L constant is
 * what keeps the sheet an even tonal wash that the foreground can still sit on top of.
 */

/** The lightness the sheet already had as a neutral grey (#a8adb6), so the change is hue only, not value. */
const LIGHTNESS = 0.7464;
/** Enough chroma to read as a gem rather than a tint, low enough not to compete with the foreground. */
const CHROMA = 0.105;
/** Ruby, citrine, peridot, aquamarine, sapphire, amethyst — around the wheel, so the bands cycle obviously. */
const HUES = [25, 75, 145, 195, 255, 310];

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

export const GEM_TONES: readonly string[] = HUES.map((hue) => oklch(LIGHTNESS, CHROMA, hue));
