import { Collapse, type HoleState } from '../black-hole/traits';
import type { World } from 'koota';
import { clamp, mat4, quat, vec3, type Mat4 } from 'math';
import { mulberry32 } from 'math/random';
import { Time } from '../time/traits';
import { Pointer } from '../input/traits';
import { Viewport } from '../viewport/traits';
import { departureAt, release, swirl } from '../black-hole/utils';
import { HORIZON, PLAY_REACH } from '../black-hole/content';
import { IconPaper, IconView, Impacts, type LatticeState, type Layout, type IconLayoutOptions } from './traits';
import { PATTERN_ANGLE, FIELD_OF_VIEW, GLYPHS, MORPH_SECONDS, STAGGER_SECONDS } from './content';

/** Fixed substeps keep stiff neighbour coupling stable. */
const SUBSTEP = 1 / 120;

export function moveIconPaper(world: World): void {
  const time = world.get(Time)!;
  const collapse = world.get(Collapse)!.hole;
  const viewport = world.get(Viewport)!;
  const pointer = world.get(Pointer)!;
  const step = Math.min(time.delta, 0.05);

  world.query(IconPaper).updateEach(([paper]) => {
    const options = paper.options!;
    const layout = paper.layout!;
    const lattice = paper.lattice!;
    paper.offset += step * options.speed * (1 - 0.7 * collapse.pull);

    if (collapse.beat === 'closed' || collapse.beat === 'play') paper.offset %= layout.loop;

    // Same rotated conveyor frame as the view, computed without reading a Three group.
    mat4.fromZRotation(lattice.world, PATTERN_ANGLE);
    lattice.world[12] = -paper.offset * Math.cos(PATTERN_ANGLE);
    lattice.world[13] = -paper.offset * Math.sin(PATTERN_ANGLE);
    lattice.world[14] = options.depth;
    mat4.invert(lattice.inverse, lattice.world);
    collectWaves(world, lattice, options.waveDelay);
    lattice.pointer.strength = pointer.strength * options.response;
    trackPointer(viewport.aspect, viewport.cameraZ, pointer, lattice);
    trackHole(viewport.cameraZ, collapse, lattice, layout);
    simulate(lattice, layout, step, options, time.now);
    advanceMorph(lattice, layout, time.now);
  });
}

/**
 * Transform new impacts into sheet space. Divide simultaneous impacts by the square root of their count to keep
 * a title landing from overpowering the paper.
 */
function collectWaves(world: World, state: LatticeState, delay: number): void {
  const pending = world.get(Impacts)!.entries;
  let batch = 0;

  for (let index = 0; index < pending.length; index += 1) if (pending[index]!.id > state.seenWave) batch += 1;

  if (batch === 0) return;

  const scale = 1 / Math.sqrt(batch);

  for (let index = 0; index < pending.length; index += 1) {
    const shock = pending[index]!;

    if (shock.id <= state.seenWave) continue;

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
function trackPointer(aspect: number, cameraZ: number, pointer: { x: number; y: number }, state: LatticeState): void {
  const depth = state.world[14];
  const distance = cameraZ - depth;
  const halfHeight = Math.tan((FIELD_OF_VIEW * Math.PI) / 360) * distance;
  const halfWidth = halfHeight * aspect;
  vec3.set(state.projected, pointer.x * halfWidth, pointer.y * halfHeight, depth);
  vec3.transformMat4(state.projected, state.projected, state.inverse);
  state.pointer.x = state.projected[0];
  state.pointer.y = state.projected[1];
}

/**
 * Project the hole into sheet space: its floor position carried along the camera's ray to the sheet's depth, so it
 * sits over the hole on screen, and its horizon scaled the same way.
 */
function trackHole(cameraZ: number, state: HoleState, lattice: LatticeState, layout: Layout): void {
  lattice.hole.pull = state.pull;
  lattice.hole.time = state.time;

  // Play's little hole never takes the paper: the cells stay on their springs, as if the hole were closed, and only
  // its gravity reaches them.
  if (state.beat === 'closed' || state.beat === 'play') {
    lattice.hole.time = -1;
    lattice.departAt.fill(Number.NaN);

    if (state.beat === 'closed') return;
  }

  // The pop takes whatever is left.
  if (state.beat === 'black') lattice.swallowed.fill(1);

  const depth = lattice.world[14];
  const along = (cameraZ - depth) / cameraZ;
  vec3.set(lattice.projected, state.x * along, state.y * along, depth);
  vec3.transformMat4(lattice.projected, lattice.projected, lattice.inverse);
  lattice.hole.x = lattice.projected[0];
  lattice.hole.y = lattice.projected[1];
  lattice.hole.horizon = state.horizon * along;

  if (state.beat === 'play') return;

  // The moment the hole opens, every cell is given its turn: nearer ones first, with some jitter.
  if (Number.isNaN(lattice.departAt[0]!)) {
    // Use visible world distance, not the repeated offscreen lattice's extent. The gravitational field reaches a new
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
    }

    state.nextSwap = now + 1.1 * 1000;
  }

  if (morph.motif < 0) return;

  const elapsed = (now - morph.start) / 1000;
  const members = layout.cellsByMotif[morph.motif]!;

  // Each member takes its new glyph edge-on, halfway through its flip.
  for (let slot = 0; slot < members.length; slot++) {
    const index = members[slot]!;

    if (elapsed >= layout.cells[index]!.delay + MORPH_SECONDS / 2) state.selected[index] = morph.to;
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

      const px = state.x[index]!;
      const py = state.y[index]!;
      const loose = looseness(state, index);
      const hold = 1 - loose;
      const damping = 3.4 + (5 - 3.4) * loose;
      let ax = -26 * hold * px - damping * state.vx[index]!;
      let ay = -26 * hold * py - damping * state.vy[index]!;

      const base = index * 4;

      for (let link = 0; link < 4; link += 1) {
        const other = layout.neighbours[base + link]!;

        if (other < 0 || state.swallowed[other] === 1) continue;

        ax += 16 * hold * (state.x[other]! - px);
        ay += 16 * hold * (state.y[other]! - py);
      }

      const restX = layout.restX[index]!;
      const restY = layout.restY[index]!;

      if (open ? !Number.isNaN(state.departAt[index]!) : state.hole.pull > 0) {
        const dx = state.hole.x - (restX + px);
        const dy = state.hole.y - (restY + py);
        const distance = Math.hypot(dx, dy);

        if (loose > 0 && distance < state.hole.horizon) {
          state.swallowed[index] = 1;
          continue;
        }

        const near = distance / state.hole.horizon;

        // While a cell holds its springs the hole's field bends the sheet without taking it: the cell is leaned in
        // and wound round the hole, and springs back once it has gone. Play's hole does only this, and the finale
        // carries it on, letting go of it as the cell lets go.
        if (hold > 0 && near < PLAY_REACH && distance > 0.0001) {
          const bend = 1 - near / PLAY_REACH;
          const force = 150 * state.hole.pull * bend * bend * hold;
          const round = swirl(near, 1);
          ax += (dx / distance) * force - (dy / distance) * force * round;
          ay += (dy / distance) * force + (dx / distance) * force * round;
        }

        if (loose > 0) {
          // Into the hole, and round it: the pull grows as the inverse square of the distance in horizons, and part
          // of it runs across the line to the centre, which is what winds the sheet into a spiral.
          const gravity = 0.12 + state.hole.pull * 3;
          const force = (240 / (near * near + 0.35) + 70) * loose * gravity;
          const round = swirl(near, 1.05);
          ax += (dx / distance) * force - (dy / distance) * force * round;
          ay += (dy / distance) * force + (dx / distance) * force * round;
        }
      }

      // Visit active wave slots directly inside the cell substeps.
      for (let wave = 0; wave < waveCount; wave += 1) {
        const entry = state.waves[state.activeWaves[wave]!]!;
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

      if (state.pointer.strength > 0) {
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
      const vx = clamp(state.vx[index]! + ax * SUBSTEP, -speed, speed);
      const vy = clamp(state.vy[index]! + ay * SUBSTEP, -speed, speed);
      state.vx[index] = vx;
      state.vy[index] = vy;
      state.x[index] = clamp(px + vx * SUBSTEP, -limit, limit);
      state.y[index] = clamp(py + vy * SUBSTEP, -limit, limit);
    }
  }
}

/** Publish lattice transforms only for prepared, mounted icon draws. */
export function syncIconViews(world: World): void {
  world.query(IconPaper, IconView).readEach(([current, mounted]) => {
    const view = mounted!;
    const state = current.lattice!;
    const layout = current.layout!;
    const { iconSize } = current.options!;
    const copies = view.glyphs;
    view.group.position.x = -current.offset;
    const now = world.get(Time)!.now;

    const { written, shown } = view;

    for (let index = 0; index < layout.cells.length; index++) {
      const selected = state.selected[index]!;
      const base = index * 16;
      // A swapped cell's new glyph must be written whatever its matrix was.
      let changed = selected !== shown[index];

      if (changed) {
        copies.setMatrixAt(index * GLYPHS.length + shown[index]!, view.hidden);
        shown[index] = selected;
      }

      const record = index * GLYPHS.length + selected;

      if (state.swallowed[index] === 1) {
        // Hidden once: the sentinel keeps a swallowed cell from writing every frame.
        if (changed || written[base] !== Number.POSITIVE_INFINITY) {
          copies.setMatrixAt(record, view.hidden);
          written.fill(Number.POSITIVE_INFINITY, base, base + 16);
        }

        continue;
      }

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

/**
 * How far a cell has let go of its springs for the hole: nothing until its turn, then all of it over a moment, and
 * nothing while the hole is closed.
 */
function looseness(state: LatticeState, index: number): number {
  const departure = state.departAt[index]!;

  return state.hole.time >= 0 && !Number.isNaN(departure) ? release(state.hole.time, departure) : 0;
}

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
  const loose = looseness(state, index);
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
