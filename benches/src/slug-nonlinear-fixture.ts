// Exact half-float contour coordinates in the authenticated Inter fixture, checked against its decoded curves.
export const SLUG_RECTANGLE = { glyph: 197, left: 180 / 2048, right: 370 / 2048, top: 1490 / 2048 };
export const SLUG_NONLINEAR_FONT_SIZE = 2048;
export const SLUG_NONLINEAR_WIDTH = (SLUG_RECTANGLE.right - SLUG_RECTANGLE.left) * SLUG_NONLINEAR_FONT_SIZE;
export const SLUG_NONLINEAR_RIGHT = (Math.sqrt(5) - 1) / 2;
export const SLUG_NONLINEAR_EDGE_PIXEL = 96.25;
export const SLUG_NONLINEAR_EXPECTED_BYTE = Math.round(0.25 * 255);

// A paired-pixel finite difference of s+s² differs from its derivative at the edge by at most 1.5/W.
// At the selected .25-pixel phase, the resulting coverage error is <= .4375/(W*sqrt(5)-1.5).
// For float32 unit roundoff e=2^-24, gamma(n)=n*e/(1-n*e) bounds accumulated rounding.
// Axis-aligned position/projection use <=32 nonzero operations on x values <=384 physical pixels;
// the normalized warp and straight-edge solve use <=16 operations on values <=2. Errors in the latter
// become pixels through W/sqrt(5). Y cannot feed X in this scene. Together they contribute <.229 byte.
// W=190: <.265 byte linearization, <=.5 byte RGBA8 quantization, and <.229 byte arithmetic: <1 byte.
// Fix this bound before reading candidate pixels; it is not a fitted backend tolerance.
const gamma = (operations: number): number => (operations * 2 ** -24) / (1 - operations * 2 ** -24);
export const SLUG_NONLINEAR_BYTE_BOUND = Math.ceil(
  (0.4375 / (SLUG_NONLINEAR_WIDTH * Math.sqrt(5) - 1.5) +
    gamma(32) * 384 +
    (gamma(16) * 2 * SLUG_NONLINEAR_WIDTH) / Math.sqrt(5)) *
    255 +
    0.5,
);
