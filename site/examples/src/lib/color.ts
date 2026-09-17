/** A saturated, light hue as `#rrggbb` (HSL 90% / 68%). */
export function hueHex(hue: number): string {
  const s = 0.9;
  const l = 0.68;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = c;
  let g = x;
  let b = 0;
  switch (Math.floor(hue / 60) % 6) {
    case 1:
      [r, g, b] = [x, c, 0];
      break;
    case 2:
      [r, g, b] = [0, c, x];
      break;
    case 3:
      [r, g, b] = [0, x, c];
      break;
    case 4:
      [r, g, b] = [x, 0, c];
      break;
    case 5:
      [r, g, b] = [c, 0, x];
      break;
    default:
      break;
  }
  const channel = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}
