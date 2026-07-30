interface OklabColor {
  readonly lightness: number;
  readonly a: number;
  readonly b: number;
}

export function createOklabColorCycle(palette: readonly number[]): (offset: number, phase: number) => number {
  if (palette.length < 2) throw new RangeError('OKLab color cycle requires at least two colors');
  const colors = palette.map(srgbHexToOklab);
  return (offset, phase) => {
    if (!Number.isSafeInteger(offset)) throw new TypeError('OKLab color offset must be an integer');
    if (!Number.isFinite(phase)) throw new TypeError('OKLab color phase must be finite');
    const position = modulo(offset + phase * colors.length, colors.length);
    const startIndex = Math.floor(position);
    const endIndex = (startIndex + 1) % colors.length;
    const amount = position - startIndex;
    const start = colors[startIndex]!;
    const end = colors[endIndex]!;
    return oklabToSrgbHex({
      lightness: lerp(start.lightness, end.lightness, amount),
      a: lerp(start.a, end.a, amount),
      b: lerp(start.b, end.b, amount),
    });
  };
}

function srgbHexToOklab(value: number): OklabColor {
  const red = srgbToLinear(((value >> 16) & 0xff) / 255);
  const green = srgbToLinear(((value >> 8) & 0xff) / 255);
  const blue = srgbToLinear((value & 0xff) / 255);
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return {
    lightness: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function oklabToSrgbHex(color: OklabColor): number {
  const l = color.lightness + 0.3963377774 * color.a + 0.2158037573 * color.b;
  const m = color.lightness - 0.1055613458 * color.a - 0.0638541728 * color.b;
  const s = color.lightness - 0.0894841775 * color.a - 1.291485548 * color.b;
  const l3 = l * l * l;
  const m3 = m * m * m;
  const s3 = s * s * s;
  const red = linearToSrgb(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3);
  const green = linearToSrgb(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3);
  const blue = linearToSrgb(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3);
  return (byte(red) << 16) | (byte(green) << 8) | byte(blue);
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const clamped = Math.max(0, Math.min(value, 1));
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

function byte(value: number): number {
  return Math.round(Math.max(0, Math.min(value, 1)) * 255);
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
