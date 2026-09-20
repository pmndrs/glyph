import { cellMatrix } from './utils';
import { Collapse, type HoleState } from '../black-hole/traits';
import type { World } from 'koota';
import { clamp, mat4, vec3 } from 'math';
import { mulberry32 } from 'math/random';
import { Time } from '../time/traits';
import { Pointer } from '../input/traits';
import { Viewport } from '../hero/traits';
import { departureAt, release, swirl } from '../black-hole/utils';
import { HORIZON } from '../black-hole/content';
import { IconField, IconView, Impacts, type LatticeState, type Layout, type IconLayoutOptions } from './traits';
import { PATTERN_ANGLE, FIELD_OF_VIEW, GLYPHS, MORPH_SECONDS, STAGGER_SECONDS } from './content';

/** Fixed substeps keep stiff neighbour coupling stable. */
const SUBSTEP = 1 / 120;

export function moveIconFields(world: World): void {
  const time = world.get(Time)!;
  const collapse = world.get(Collapse)!.hole;
  const viewport = world.get(Viewport)!;
  const pointer = world.get(Pointer)!;
  const step = Math.min(time.delta, 0.05);

  world.query(IconField).updateEach(([field]) => {
    const options = field.options!;
    const layout = field.layout!;
    const lattice = field.lattice!;
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

/** Motifs change on the render clock. No timers, sets, callbacks, or temporary candidate arrays. */
export function advanceMorph(state: LatticeState, layout: Layout, now: number): void {
  const morph = state.morph;

  if (state.nextSwap === 0) state.nextSwap = now + 1.1 * 1000;

  if (morph.motif < 0 && now >= state.nextSwap) {
    let count = 0;

    for (let glyph = 0; glyph < GLYPHS.length; glyph++) {
      if (!state.motifGlyphs.includes(glyph)) state.spare[count++] = glyph;
    }

    if (count > 0) {
      morph.motif = Math.floor(mulberry32.sample(state.random) * state.motifGlyphs.length);
      morph.to = state.spare[Math.floor(mulberry32.sample(state.random) * count)]!;
      morph.start = now;
      state.motifGlyphs[morph.motif] = morph.to;
      state.applied.fill(0);
    }

    state.nextSwap = now + 1.1 * 1000;
  }

  if (morph.motif < 0) return;

  const elapsed = (now - morph.start) / 1000;
  const members = layout.cellsByMotif[morph.motif]!;

  for (let slot = 0; slot < members.length; slot++) {
    const index = members[slot]!;

    if (state.applied[index] === 1 || elapsed < layout.cells[index]!.delay + MORPH_SECONDS / 2) continue;

    state.selected[index] = morph.to;
    state.applied[index] = 1;
  }

  if (elapsed > STAGGER_SECONDS + MORPH_SECONDS) morph.motif = -1;
}

/** Fixed-step integration: spring home, damping, neighbour coupling, the travelling ring, and the pointer. */
export function simulate(
  state: LatticeState,
  layout: Layout,
  delta: number,
  layer: IconLayoutOptions,
  now: number,
): void {
  const count = layout.cells.length;
  const open = state.hole.time >= 0;
  const limit = open ? 60 : 2.4;
  let waveCount = 0;

  for (let index = 0; index < state.waves.length; index++) {
    const wave = state.waves[index]!;
    const seconds = (now - wave.start) / 1000;

    if (seconds <= 0 || seconds > 2) continue;

    wave.radius = layer.waveSpeed * seconds;
    state.activeWaves[waveCount++] = index;
  }

  state.accumulator = Math.min(state.accumulator + delta, SUBSTEP * 8);
  let guard = 0;

  while (state.accumulator >= SUBSTEP && guard < 8) {
    state.accumulator -= SUBSTEP;
    guard += 1;

    for (let index = 0; index < count; index += 1) {
      if (state.swallowed[index] === 1) continue;

      const px = state.x[index] ?? 0;
      const py = state.y[index] ?? 0;
      // A cell's turn: it holds its place until its moment, then gradually lets go of
      // its springs entirely and is pulled in.
      const departure = open ? (state.departAt[index] ?? Number.NaN) : Number.NaN;
      const loose = open && !Number.isNaN(departure) ? release(state.hole.time, departure) : 0;
      const hold = 1 - loose;
      const damping = 3.4 + (5 - 3.4) * loose;
      let ax = -26 * hold * px - damping * (state.vx[index] ?? 0);
      let ay = -26 * hold * py - damping * (state.vy[index] ?? 0);

      const base = index * 4;

      for (let link = 0; link < 4; link += 1) {
        const other = layout.neighbours[base + link] ?? -1;

        if (other < 0 || state.swallowed[other] === 1) continue;

        ax += 16 * hold * ((state.x[other] ?? 0) - px);
        ay += 16 * hold * ((state.y[other] ?? 0) - py);
      }

      const restX = layout.restX[index] ?? 0;
      const restY = layout.restY[index] ?? 0;

      if (open && !Number.isNaN(departure)) {
        const dx = state.hole.x - (restX + px);
        const dy = state.hole.y - (restY + py);
        const distance = Math.hypot(dx, dy);

        if (loose > 0 && distance < state.hole.horizon) {
          state.swallowed[index] = 1;
          continue;
        }

        if (loose > 0) {
          // Into the hole, and round it: the pull grows as the inverse square of the distance in horizons, and part
          // of it runs across the line to the centre, which is what winds the sheet into a spiral.
          const near = distance / state.hole.horizon;
          const gravity = 0.12 + state.hole.pull * 3;
          const force = (240 / (near * near + 0.35) + 70) * loose * gravity;
          const round = swirl(near, 1.05);
          ax += (dx / distance) * force - (dy / distance) * force * round;
          ay += (dy / distance) * force + (dx / distance) * force * round;
        }
      }

      // Visit active wave slots directly inside the cell substeps.
      for (let wave = 0; wave < waveCount; wave += 1) {
        const entry = state.waves[state.activeWaves[wave]!];

        if (entry === undefined) continue;

        const dx = restX - entry.x;
        const dy = restY - entry.y;
        const distance = Math.hypot(dx, dy);
        const front = distance - entry.radius;
        const band = Math.exp(-(front * front) / (2 * 2.2 * 2.2));

        if (band <= 0.002 || distance <= 0.0001) continue;

        const push = (layer.waveImpulse * entry.scale * band) / (1 + distance * 0.35);
        ax += (dx / distance) * push;
        ay += (dy / distance) * push;
      }

      if (state.pointer.active && state.pointer.strength > 0) {
        const dx = restX + px - state.pointer.x;
        const dy = restY + py - state.pointer.y;
        const distance = Math.hypot(dx, dy);

        if (distance < 4.5 && distance > 0.0001) {
          const falloff = 1 - distance / 4.5;
          const push = 26 * state.pointer.strength * falloff * falloff;
          ax += (dx / distance) * push;
          ay += (dy / distance) * push;
        }
      }

      const speed = open ? 26 * 3 : 26;
      const vx = clamp((state.vx[index] ?? 0) + ax * SUBSTEP, -speed, speed);
      const vy = clamp((state.vy[index] ?? 0) + ay * SUBSTEP, -speed, speed);
      state.vx[index] = vx;
      state.vy[index] = vy;
      state.x[index] = clamp(px + vx * SUBSTEP, -limit, limit);
      state.y[index] = clamp(py + vy * SUBSTEP, -limit, limit);
    }
  }
}

/** Publish lattice transforms only for prepared, mounted icon draws. */
export function syncIconViews(world: World): void {
  world.query(IconField, IconView).readEach(([current, mounted]) => {
    const view = mounted!;
    const state = current.lattice!;
    const layout = current.layout!;
    const { iconSize } = current.options!;
    const copies = view.glyphs;
    view.group.position.x = -current.offset;
    const now = world.get(Time)!.now;

    for (let index = 0; index < layout.cells.length; index++) {
      const selected = state.selected[index]!;
      const previous = state.previous[index]!;

      if (selected !== previous) {
        copies.setMatrixAt(index * GLYPHS.length + previous, view.hidden);
        state.previous[index] = selected;
      }

      const record = index * GLYPHS.length + selected;

      if (state.swallowed[index] === 1) copies.setMatrixAt(record, view.hidden);
      else {
        cellMatrix(state.matrix, state, layout, index, view.baselines[record]!, iconSize, now);
        copies.setMatrixAt(record, view.matrix.fromArray(state.matrix));
      }
    }
  });
}
