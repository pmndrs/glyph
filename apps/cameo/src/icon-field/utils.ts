import { mat4, quat, vec3, type Mat4 } from 'math';
import { MORPH_SECONDS } from './content';
import type { LatticeState, Layout } from './traits';

/** Compose one cell directly. Baseline is the precomputed glyph centering offset. */
export function cellMatrix(
  out: Mat4,
  state: LatticeState,
  layout: Layout,
  index: number,
  baseline: number,
  iconSize: number,
  now: number,
): Mat4 {
  const x = layout.restX[index]! + state.x[index]!;
  const y = layout.restY[index]! + state.y[index]!;
  let flip = 0;

  if (state.morph.motif === layout.motifOfCell[index]) {
    const progress = ((now - state.morph.start) / 1000 - layout.cells[index]!.delay) / MORPH_SECONDS;

    if (progress > 0 && progress < 1) flip = Math.PI * (progress < 0.5 ? progress : 1 - progress);
  }

  // The sheets are printed on the floor, so a flip turns in the plane of the print rather than out of it: the cell
  // is squeezed flat across its own width and let out again with the new glyph behind it. Halfway through it is a
  // line, which is the moment the exchange is made and the only moment it could be seen.
  quat.identity(state.rotation);
  vec3.set(state.position, x, y, 0);
  vec3.set(state.scale, Math.cos(flip), 1, 1);
  mat4.fromRotationTranslationScale(out, state.rotation, state.position, state.scale);
  vec3.set(state.position, baseline, iconSize / 2, 0);

  return mat4.translate(out, out, state.position);
}
