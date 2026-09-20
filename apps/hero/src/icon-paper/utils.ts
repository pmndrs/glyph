import { mat4, quat, vec3, type Mat4 } from 'math';
import { release } from '../black-hole/utils';
import { MORPH_SECONDS } from './content';
import type { Layout, LatticeState } from './traits';

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
  const departure = state.departAt[index]!;
  const loose = state.hole.time >= 0 && !Number.isNaN(departure) ? release(state.hole.time, departure) : 0;
  let grow = 1;

  if (loose > 0) {
    const dx = state.hole.x - x;
    const dy = state.hole.y - y;
    const nearSquared = (dx * dx + dy * dy) / (state.hole.horizon * state.hole.horizon);
    grow += (1.6 * loose) / (nearSquared + 0.35);
  }

  const vx = state.vx[index]!;
  const vy = state.vy[index]!;
  const stretch = 1 + Math.min(1.8, Math.hypot(vx, vy) * 0.045) * loose;
  let flip = 0;

  if (state.morph.motif === layout.motifOfCell[index]) {
    const progress = ((now - state.morph.start) / 1000 - layout.cells[index]!.delay) / MORPH_SECONDS;

    if (progress > 0 && progress < 1) flip = progress < 0.5 ? Math.PI * progress : -Math.PI * (1 - progress);
  }

  state.angles[1] = flip;
  state.angles[2] = loose > 0 ? Math.atan2(vy, vx) * loose : 0;
  quat.fromEuler(state.rotation, state.angles);
  vec3.set(state.position, x, y, 0);
  vec3.set(state.scale, grow * stretch, grow / Math.sqrt(stretch), 1);
  mat4.fromRotationTranslationScale(out, state.rotation, state.position, state.scale);
  vec3.set(state.position, baseline, iconSize / 2, 0);

  return mat4.translate(out, out, state.position);
}
