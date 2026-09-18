import type { World } from 'koota';
import { mat4, vec3 } from 'math';
import { Frame, Sequence } from '../sequence/traits';
import { departureAt } from '../sequence/departure';
import { HORIZON, type HoleState } from '../sequence/motion';
import { Field } from './traits';
import {
  PATTERN_ANGLE,
  POINTER_FADE,
  FIELD_OF_VIEW,
  simulate,
  advanceMorph,
  type LatticeState,
  type Layout,
} from './lattice';

export function moveFields(world: World): void {
  const frame = world.get(Frame)!;
  const sequence = world.get(Sequence)!;
  const collapse = sequence.hole;
  const step = Math.min(frame.delta, 0.05);
  frame.pointer.strength *= Math.exp(-step / POINTER_FADE);
  if (frame.pointer.strength < 0.01) frame.pointer.strength = 0;
  world.query(Field).updateEach(([field]) => {
    const { options, layout, lattice } = field;
    field.offset += step * options.speed * (1 - 0.7 * collapse.pull);
    if (collapse.beat === 'closed') field.offset %= layout.loop;
    // Same rotated conveyor frame as the view, computed without reading a Three group.
    mat4.fromZRotation(lattice.world, PATTERN_ANGLE);
    lattice.world[12] = -field.offset * Math.cos(PATTERN_ANGLE);
    lattice.world[13] = -field.offset * Math.sin(PATTERN_ANGLE);
    lattice.world[14] = options.depth;
    mat4.invert(lattice.inverse, lattice.world);
    collectWaves(world, lattice, options.waveDelay);
    lattice.pointer.strength = frame.pointer.strength * options.response;
    trackPointer(frame.aspect, frame.cameraZ, frame.pointer, lattice, options.response);
    trackHole(sequence.replays, frame.cameraZ, collapse, lattice, layout);
    simulate(lattice, layout, step, options, frame.now);
    advanceMorph(lattice, layout, frame.now);
  });
}

/**
 * Takes every impact published since the last frame into the sheet's own space, where the lattice lives. A batch that
 * arrives together — the title's letters — has its strength divided across the batch, so a five-letter word disturbs
 * the sheet about as hard as one impact did, but in the shape of the word.
 */
function collectWaves(world: World, state: LatticeState, delay: number): void {
  const pending = world.get(Sequence)!.impacts;
  let batch = 0;
  for (let index = 0; index < pending.length; index += 1) if ((pending[index]?.id ?? 0) > state.seenWave) batch += 1;
  if (batch === 0) return;
  const scale = 1 / Math.sqrt(batch);
  for (let index = 0; index < pending.length; index += 1) {
    const shock = pending[index];
    if (shock === undefined || shock.id <= state.seenWave) continue;

    vec3.transformMat4(state.projected, shock.world, state.inverse);
    // Deeper layers answer a beat later, so the impact travels through the stack instead of striking it flat.
    const wave = state.waves[state.waveCursor]!;
    state.waveCursor = (state.waveCursor + 1) % state.waves.length;
    wave.start = shock.at + delay * 1000;
    wave.x = state.projected[0];
    wave.y = state.projected[1];
    wave.scale = scale;
  }
  for (let index = 0; index < pending.length; index++) state.seenWave = Math.max(state.seenWave, pending[index]!.id);
}

/** Projects the pointer onto this layer's plane and stores it in sheet space. */
function trackPointer(
  aspect: number,
  cameraZ: number,
  pointer: { x: number; y: number },
  state: LatticeState,
  response: number,
): void {
  const target = state.pointer;
  if (response <= 0) {
    target.active = false;
    return;
  }
  const depth = state.world[14];
  const distance = cameraZ - depth;
  const halfHeight = Math.tan((FIELD_OF_VIEW * Math.PI) / 360) * distance;
  const halfWidth = halfHeight * aspect;
  vec3.set(state.projected, pointer.x * halfWidth, pointer.y * halfHeight, depth);
  vec3.transformMat4(state.projected, state.projected, state.inverse);
  target.x = state.projected[0];
  target.y = state.projected[1];
  target.active = true;
}

/**
 * Brings the black hole into sheet space. It sits on the camera's axis, so on this sheet it is where the sheet
 * crosses that axis, with a horizon widened by the sheet's distance from the camera. A replay gives the hole's
 * catch back and puts every cell home.
 */
function trackHole(replays: number, cameraZ: number, state: HoleState, lattice: LatticeState, layout: Layout): void {
  if (replays !== lattice.replays) {
    lattice.replays = replays;
    lattice.swallowed.fill(0);
    lattice.x.fill(0);
    lattice.y.fill(0);
    lattice.vx.fill(0);
    lattice.vy.fill(0);
  }
  lattice.hole.pull = state.pull;
  lattice.hole.time = state.time;
  if (state.beat === 'closed') {
    lattice.departAt.fill(Number.NaN);
    return;
  }
  // The pop takes whatever is left.
  if (state.beat === 'black') lattice.swallowed.fill(1);
  const depth = lattice.world[14];
  vec3.set(lattice.projected, state.x, state.y, depth);
  vec3.transformMat4(lattice.projected, lattice.projected, lattice.inverse);
  lattice.hole.x = lattice.projected[0];
  lattice.hole.y = lattice.projected[1];
  lattice.hole.horizon = (state.horizon * (cameraZ - depth)) / cameraZ;
  // The moment the hole opens, every cell is given its turn: nearer ones first, with some jitter.
  if (Number.isNaN(lattice.departAt[0] ?? Number.NaN)) {
    // Use visible world distance, not the repeated offscreen lattice's extent. The field reaches a new
    // band of the viewport as gravity builds, consistently at both sheet depths.
    const reachOnSheet = (HORIZON * 9 * (cameraZ - depth)) / cameraZ;
    for (let index = 0; index < lattice.departAt.length; index += 1) {
      lattice.departAt[index] = departureAt(
        Math.hypot(
          lattice.hole.x - (layout.restX[index]! + lattice.x[index]!),
          lattice.hole.y - (layout.restY[index]! + lattice.y[index]!),
        ) / reachOnSheet,
        index,
      );
    }
  }
}
