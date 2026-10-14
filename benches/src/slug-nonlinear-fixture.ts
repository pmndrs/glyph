// Exact half-float contour coordinates in the authenticated Inter fixture, checked against its decoded curves.
export const SLUG_RECTANGLE = { glyph: 197, left: 180 / 2048, right: 370 / 2048, top: 1490 / 2048 };
export const SLUG_NONLINEAR_FONT_SIZE = 2048;
export const SLUG_NONLINEAR_WIDTH = (SLUG_RECTANGLE.right - SLUG_RECTANGLE.left) * SLUG_NONLINEAR_FONT_SIZE;
export const SLUG_NONLINEAR_QUAD_LEFT = 1;
export const SLUG_NONLINEAR_Y_SCALE = 1 / 16;
export const SLUG_NONLINEAR_EDGE_PIXEL = 96.25;
export const SLUG_NONLINEAR_RIGHT = (SLUG_NONLINEAR_EDGE_PIXEL - SLUG_NONLINEAR_QUAD_LEFT) / SLUG_NONLINEAR_WIDTH;
export const SLUG_NONLINEAR_QUADRATIC = (1 - SLUG_NONLINEAR_RIGHT) / SLUG_NONLINEAR_RIGHT ** 2;
export const SLUG_NONLINEAR_EXPECTED_BYTE = Math.round((SLUG_NONLINEAR_EDGE_PIXEL % 1) * 255);

// The carrier's dilated quad is [.5,191.5] x [16.9375,111.0625] pixels: exact 1/16-pixel vertices,
// wholly inside the target. X coordinates come from fragment pixel centers, not interpolated varyings;
// the original probe's irrational quad placement left rasterization/interpolation precision unbounded.
// For q(s)=s+a*s², a=(1-r)/r² puts q(r)=1 at the independently chosen 96.25-pixel contour.
// Its derivative J=1+2ar changes with s. At the selected d=.25-pixel phase, the paired finite difference
// has derivative error in [-.5a/W,1.5a/W]; the coverage error is <= .3125a/(WJ-1.5a).
// Screen centers/subtracting 1 are exact. In the sampled pair, a<2 and x/width<2; <=32 rounded
// positive arithmetic operations/input conversions give normalized coordinate error epsilon=2*gamma(32).
// The derivative subtracts two coordinates, so its error is <=2epsilon. The coverage ratio is <1/3:
// its error is <= (5/3)*epsilon/(minimumDerivative-2epsilon), plus gamma(8) for final coverage math.
// These bounds contribute <.384 byte; linear RGBA8 quantization adds <=.5 byte, hence a one-byte gate.
// Keep this independently derived bound fixed; do not fit it to observed candidate pixels.
const gamma = (operations: number): number => (operations * 2 ** -24) / (1 - operations * 2 ** -24);
const derivative = 1 + 2 * SLUG_NONLINEAR_QUADRATIC * SLUG_NONLINEAR_RIGHT;
const minimumDerivative = (derivative - (1.5 * SLUG_NONLINEAR_QUADRATIC) / SLUG_NONLINEAR_WIDTH) / SLUG_NONLINEAR_WIDTH;
const coordinateError = 2 * gamma(32);
export const SLUG_NONLINEAR_BYTE_BOUND = Math.ceil(
  ((0.3125 * SLUG_NONLINEAR_QUADRATIC) / (SLUG_NONLINEAR_WIDTH * derivative - 1.5 * SLUG_NONLINEAR_QUADRATIC) +
    ((5 / 3) * coordinateError) / (minimumDerivative - 2 * coordinateError) +
    gamma(8)) *
    255 +
    0.5,
);
