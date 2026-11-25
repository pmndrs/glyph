// Where the pixel-snapping parity scenes (TypeGPU and PixiJS 3D) put their rows: the first on whole pixels, where
// strike quads sit exactly halfway between pixels, the rest at fractional offsets on both axes.
export const SNAPPED_ROWS: readonly { readonly x: number; readonly y: number }[] = [
  [0, 0],
  [0.37, 0.61],
  [0.73, 0.18],
  [0.21, 0.94],
].map(([dx, dy], row) => ({ x: 10 + dx!, y: 10 + row * 70 + dy! }));
