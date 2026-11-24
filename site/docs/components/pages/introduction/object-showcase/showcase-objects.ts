import { Color, SRGBColorSpace } from 'three';

export const SHOWCASE_FLOOR_Y = -1.25;
export const SHOWCASE_LABEL_CLEARANCE = 0.3;

export type ShowcaseCategory = 'console' | 'editor' | 'energy' | 'launch' | 'palette' | 'studio';

export type ShowcaseObject = Readonly<{
  category: ShowcaseCategory;
  id: string;
  icon: 'bolt' | 'paintbrush' | 'palette' | 'pen-to-square' | 'power-off' | 'rocket';
  label: string;
  description: string;
  iconColor: string;
  position: readonly [number, number];
  size: readonly [number, number, number];
  color: Color;
  role: 'generated' | 'primary';
}>;

export const SHOWCASE_OBJECTS: readonly ShowcaseObject[] = [
  object(
    'launch',
    'rocket',
    'Launch',
    'Open the high-density label scene and stress the shared Glyph batches without giving every label its own renderer.',
    [-3.7, 1.5],
    [1.75, 2, 1.55],
    [0.72, 0.16, 20],
  ),
  object(
    'studio',
    'paintbrush',
    'Studio',
    'Compose expressive scene labels with retained text and custom materials.',
    [-1.3, 1.3],
    [1.1, 1.2, 1.1],
    [0.74, 0.16, 345],
  ),
  object(
    'palette',
    'palette',
    'Palette',
    'Color, outline, shadow, and fallback spans stay independently styleable inside one batch.',
    [1.45, 1.2],
    [1.4, 1.4, 1.4],
    [0.7, 0.16, 305],
  ),
  object(
    'energy',
    'bolt',
    'Energy',
    'Retained publications update only the records that changed, keeping animated text responsive.',
    [4, 0.65],
    [1.3, 1.6, 1.3],
    [0.8, 0.15, 88],
  ),
  object(
    'console',
    'power-off',
    'Console',
    'Use measured bounds and world transforms to bind Glyph text to interactive Three objects.',
    [-2.75, -1.45],
    [1.55, 1.8, 1.35],
    [0.74, 0.13, 220],
  ),
  object(
    'editor',
    'pen-to-square',
    'Editor',
    'Caret, selection, shaping, and layout data remain available through the imperative text API.',
    [2.35, -1.6],
    [1, 1, 1],
    [0.73, 0.14, 150],
  ),
];

/** A label's origin is always centered over its object's X/Z footprint. */
export function labelAnchor(
  item: ShowcaseObject,
  bob = 0,
  scaleY = 1,
  clearanceScale = 1,
): readonly [number, number, number] {
  return [
    item.position[0],
    SHOWCASE_FLOOR_Y + item.size[1] * scaleY + SHOWCASE_LABEL_CLEARANCE * clearanceScale + bob,
    item.position[1],
  ];
}

function object(
  id: ShowcaseCategory,
  icon: ShowcaseObject['icon'],
  label: string,
  description: string,
  position: ShowcaseObject['position'],
  size: ShowcaseObject['size'],
  oklch: readonly [lightness: number, chroma: number, hue: number],
): ShowcaseObject {
  const color = colorFromOklch(...oklch);
  return Object.freeze({
    category: id,
    color,
    description,
    icon,
    iconColor: `#${color.getHexString(SRGBColorSpace)}`,
    id,
    label,
    position,
    role: 'primary',
    size,
  });
}

/** Convert authored OKLCH design colors into Three's linear working color space. */
export function colorFromOklch(lightness: number, chroma: number, hue: number): Color {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const lRoot = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lRoot * lRoot * lRoot;
  const m = mRoot * mRoot * mRoot;
  const s = sRoot * sRoot * sRoot;
  return new Color(
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  );
}

/** Convert Three's linear working color into OKLCH for perceptual theme variations. */
export function colorToOklch(color: Readonly<{ r: number; g: number; b: number }>): readonly [number, number, number] {
  const lRoot = Math.cbrt(0.4122214708 * color.r + 0.5363325363 * color.g + 0.0514459929 * color.b);
  const mRoot = Math.cbrt(0.2119034982 * color.r + 0.6806995451 * color.g + 0.1073969566 * color.b);
  const sRoot = Math.cbrt(0.0883024619 * color.r + 0.2817188376 * color.g + 0.6299787005 * color.b);
  const lightness = 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot;
  const a = 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot;
  const b = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot;
  const chroma = Math.hypot(a, b);
  const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return [lightness, chroma, hue];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
