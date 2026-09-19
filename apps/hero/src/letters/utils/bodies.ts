import { mat4, vec3 } from 'math';
import { Body } from '../../physics/traits';
import type { TitleBodies } from '../traits';

/** Project entity poses after physics and collect this frame's landings. */
export function updateTitle(state: TitleBodies): void {
  state.landingCount = 0;

  for (let index = 0; index < state.pieces.length; index++) {
    const body = state.pieces[index]!.entity.get(Body)!;

    if (body.moved) writeLetter(state, index);

    if (!body.landed) continue;

    const landing = state.landings[state.landingCount++]!;
    landing.index = index;
    landing.x = body.position[0];
    landing.y = body.position[1];
  }
}

export function titleReach(state: TitleBodies): number {
  let reach = 0;

  for (let index = 0; index < state.pieces.length; index++) {
    const body = state.pieces[index]!.entity.get(Body)!;
    const qx = body.rotation[0];
    const qy = body.rotation[1];
    const upright = 1 - 2 * (qx * qx + qy * qy);
    reach = Math.max(reach, body.position[2] + Math.sqrt(Math.max(0, 1 - upright * upright)) * 3.2);
  }

  return reach;
}

/** Publish each simulated pose into the retained matrix stream consumed by the view. */
export function writeLetter(state: TitleBodies, index: number): void {
  const piece = state.pieces[index]!;
  const body = piece.entity.get(Body)!;
  const grow = state.grow[index]!;
  vec3.set(state.scale, grow, grow, 1);
  mat4.fromRotationTranslationScale(state.body, body.rotation, body.position, state.scale);
  mat4.multiply(state.matrix, state.inverse, state.body);
  mat4.multiply(state.matrix, state.matrix, piece.offset);
  state.matrices.set(state.matrix, index * 16);
}
