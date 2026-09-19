import type { World } from 'koota';
import { mat4, vec3 } from 'math';
import { Time } from '../time/traits';
import { Pointer } from '../input/traits';
import { Viewport } from '../view/traits';
import { departureAt, HORIZON, type HoleState } from '../black-hole/utils';
import { Field, Impacts } from './traits';
import { PATTERN_ANGLE, FIELD_OF_VIEW, simulate, advanceMorph, type LatticeState, type Layout } from './utils/lattice';

export function moveFields(world: World, collapse: HoleState): void {
  const time = world.get(Time)!;
  const viewport = world.get(Viewport)!;
  const pointer = world.get(Pointer)!;
  const step = Math.min(time.delta, 0.05);

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
    lattice.pointer.strength = pointer.strength * options.response;
    trackPointer(viewport.aspect, viewport.cameraZ, pointer, lattice, options.response);
    trackHole(viewport.cameraZ, collapse, lattice, layout);
    simulate(lattice, layout, step, options, time.now);
    advanceMorph(lattice, layout, time.now);
  });
}

/**
 * Transform new impacts into sheet space. Divide simultaneous impacts by the square root of their count to keep
 * a title landing from overpowering the field.
 */
function collectWaves(world: World, state: LatticeState, delay: number): void {
  const pending = world.get(Impacts)!.entries;
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

/** Project the hole into sheet space and scale its horizon with depth. */
function trackHole(cameraZ: number, state: HoleState, lattice: LatticeState, layout: Layout): void {
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
