import type { World } from 'koota';
import { clamp, mat4, vec3 } from 'math';
import { mulberry32 } from 'math/random';
import { Time } from '../time/traits';
import { GLYPHS, MORPH_SECONDS, PATTERN_ANGLE, PATTERN_CENTRE, ROBOT_REACH, STAGGER_SECONDS } from './content';
import { IconField, IconView, Shocks, type IconLayoutOptions, type LatticeState, type Layout } from './traits';
import { cellMatrix } from './utils';

/** Fixed substeps keep stiff neighbour coupling stable. */
const SUBSTEP = 1 / 120;

export function moveIconField(world: World): void {
  const time = world.get(Time)!;
  const step = Math.min(time.delta, 0.05);

  world.query(IconField).updateEach(([sheet]) => {
    const options = sheet.options!;
    const layout = sheet.layout!;
    const lattice = sheet.lattice!;
    sheet.offset = (sheet.offset + step * options.speed) % layout.loop;

    // Same rotated conveyor frame as the view, computed without reading a Three group.
    mat4.fromZRotation(lattice.world, PATTERN_ANGLE);
    lattice.world[12] = PATTERN_CENTRE[0] - sheet.offset * Math.cos(PATTERN_ANGLE);
    lattice.world[13] = PATTERN_CENTRE[1] - sheet.offset * Math.sin(PATTERN_ANGLE);
    lattice.world[14] = options.height;
    mat4.invert(lattice.inverse, lattice.world);
    collectWaves(world, lattice, options.waveDelay);
    simulate(lattice, layout, step, options, time.now);
    advanceMorph(lattice, layout, time.now);
  });
}

/** Carry the robot's footprint into each sheet's own frame, so its wheels shove the cells they roll past. */
export function pressIconField(world: World, x: number, y: number, pressing: boolean): void {
  world.query(IconField).updateEach(([sheet]) => {
    const lattice = sheet.lattice!;
    const response = sheet.options!.response;
    lattice.presser.active = pressing && response > 0;
    lattice.presser.strength = response;

    if (!lattice.presser.active) return;

    vec3.set(lattice.projected, x, y, sheet.options!.height);
    vec3.transformMat4(lattice.projected, lattice.projected, lattice.inverse);
    lattice.presser.x = lattice.projected[0];
    lattice.presser.y = lattice.projected[1];
  });
}

/**
 * Transform new shocks into sheet space. Divide simultaneous shocks by the square root of their count so a burst
 * never overpowers the floor.
 */
function collectWaves(world: World, state: LatticeState, delay: number): void {
  const pending = world.get(Shocks)!.entries;
  let batch = 0;

  for (let index = 0; index < pending.length; index += 1) if ((pending[index]?.id ?? 0) > state.seenWave) batch += 1;

  if (batch === 0) return;

  const scale = 1 / Math.sqrt(batch);

  for (let index = 0; index < pending.length; index += 1) {
    const shock = pending[index];

    if (shock === undefined || shock.id <= state.seenWave) continue;

    vec3.transformMat4(state.projected, shock.world, state.inverse);
    // The finer sheet answers a beat later, so a thump travels through the stack instead of striking it flat.
    const wave = state.waves[state.waveCursor]!;
    state.waveCursor = (state.waveCursor + 1) % state.waves.length;
    wave.start = shock.at + delay * 1000;
    wave.x = state.projected[0];
    wave.y = state.projected[1];
    wave.scale = scale;
  }

  for (let index = 0; index < pending.length; index++) state.seenWave = Math.max(state.seenWave, pending[index]!.id);
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

/** Fixed-step integration: spring home, damping, neighbour coupling, the travelling ring, and the robot. */
export function simulate(
  state: LatticeState,
  layout: Layout,
  delta: number,
  sheet: IconLayoutOptions,
  now: number,
): void {
  const count = layout.cells.length;
  let waveCount = 0;

  for (let index = 0; index < state.waves.length; index++) {
    const wave = state.waves[index]!;
    const seconds = (now - wave.start) / 1000;

    if (seconds <= 0 || seconds > 2) continue;

    wave.radius = sheet.waveSpeed * seconds;
    state.activeWaves[waveCount++] = index;
  }

  state.accumulator = Math.min(state.accumulator + delta, SUBSTEP * 8);
  let guard = 0;

  while (state.accumulator >= SUBSTEP && guard < 8) {
    state.accumulator -= SUBSTEP;
    guard += 1;

    for (let index = 0; index < count; index += 1) {
      const px = state.x[index] ?? 0;
      const py = state.y[index] ?? 0;
      let ax = -26 * px - 3.4 * (state.vx[index] ?? 0);
      let ay = -26 * py - 3.4 * (state.vy[index] ?? 0);
      const base = index * 4;

      for (let link = 0; link < 4; link += 1) {
        const other = layout.neighbours[base + link] ?? -1;

        if (other < 0) continue;

        ax += 16 * ((state.x[other] ?? 0) - px);
        ay += 16 * ((state.y[other] ?? 0) - py);
      }

      const restX = layout.restX[index] ?? 0;
      const restY = layout.restY[index] ?? 0;

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

        const push = (sheet.waveImpulse * entry.scale * band) / (1 + distance * 0.35);
        ax += (dx / distance) * push;
        ay += (dy / distance) * push;
      }

      if (state.presser.active && state.presser.strength > 0) {
        const dx = restX + px - state.presser.x;
        const dy = restY + py - state.presser.y;
        const distance = Math.hypot(dx, dy);

        if (distance < ROBOT_REACH && distance > 0.0001) {
          const falloff = 1 - distance / ROBOT_REACH;
          const push = 26 * state.presser.strength * falloff * falloff;
          ax += (dx / distance) * push;
          ay += (dy / distance) * push;
        }
      }

      const vx = clamp((state.vx[index] ?? 0) + ax * SUBSTEP, -26, 26);
      const vy = clamp((state.vy[index] ?? 0) + ay * SUBSTEP, -26, 26);
      state.vx[index] = vx;
      state.vy[index] = vy;
      state.x[index] = clamp(px + vx * SUBSTEP, -2.4, 2.4);
      state.y[index] = clamp(py + vy * SUBSTEP, -2.4, 2.4);
    }
  }
}

/** Publish lattice transforms only for prepared, mounted icon draws. */
export function syncIconViews(world: World): void {
  const now = world.get(Time)!.now;

  world.query(IconField, IconView).readEach(([current, mounted]) => {
    const view = mounted!;
    const state = current.lattice!;
    const layout = current.layout!;
    const { iconSize } = current.options!;
    const copies = view.glyphs;
    view.group.position.x = -current.offset;
    const { written } = view;

    for (let index = 0; index < layout.cells.length; index++) {
      const selected = state.selected[index]!;
      const previous = state.previous[index]!;
      const base = index * 16;
      // A swapped cell's new glyph must be written whatever its matrix was.
      let changed = selected !== previous;

      if (changed) {
        copies.setMatrixAt(index * GLYPHS.length + previous, view.hidden);
        state.previous[index] = selected;
      }

      const record = index * GLYPHS.length + selected;
      cellMatrix(state.matrix, state, layout, index, view.baselines[record]!, iconSize, now);

      // A cell at rest still settles by hairs on its springs; only a visible move is worth an upload.
      for (let lane = 0; lane < 16 && !changed; lane++) {
        const value = state.matrix[lane]!;

        if (!(Math.abs(value - written[base + lane]!) <= 0.0001)) changed = true;
      }

      if (!changed) continue;

      copies.setMatrixAt(record, view.matrix.fromArray(state.matrix));
      written.set(state.matrix, base);
    }
  });
}
