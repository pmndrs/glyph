import { clamp, euler, mat4, quat, vec3, type Mat4 } from 'math';
import { mulberry32 } from 'math/random';
import { ICON_CODE_POINTS, type IconName, type Vec3 } from '../content';
import { GEM_TONES } from '../materials/gems';
import { release, swirl } from '../sequence/departure';

/** Scroll direction, as an angle from the x axis. Both layers share it, so the field moves as one. */
export const PATTERN_ANGLE = -0.32;
/** How long one flip takes, and the window over which a motif's cells start theirs. */
const MORPH_SECONDS = 0.32;
const STAGGER_SECONDS = 0.5;
/**
 * Start times are quantised across the stagger window. The overlapping 0.32s flips retain the original sweep;
 * exchanging their glyph records now happens entirely in the retained instance buffer.
 */
const STAGGER_STEPS = 5;
/** Seconds between motif changes. */
const SWAP_INTERVAL = 1.1;

/** Mass–spring lattice: each cell is pulled home, damped, and coupled to its neighbours, which carries the wave. */
const STIFFNESS = 26;
const DAMPING = 3.4;
/** Coupling stays well under the pull-home stiffness, or the sheet drifts instead of settling. */
const COUPLING = 16;
/** Impact ring: how wide the front is and when it is spent. Speed, strength and delay are per layer. */
const WAVE_WIDTH = 2.2;
const WAVE_SECONDS = 2;
/** The title strikes once per letter, so several rings run at once; more than this and the sheet just boils. */
const MAX_WAVES = 12;
/** Pointer: a soft push around the cursor, so moving the mouse stirs the field. The push follows movement and fades
 * once the cursor is still, so a parked mouse leaves the lattice alone. */
const POINTER_RADIUS = 4.5;
const POINTER_FORCE = 26;
export const POINTER_FADE = 0.16;

/** Bounds: a cell never leaves its own neighbourhood, whatever the wave does. */
const MAX_OFFSET = 2.4;
const MAX_SPEED = 26;
/** The black hole: how hard it pulls at one horizon, how much of that goes round rather than in, how far a cell may
 * travel to it, and how much a cell grows on the way so its bent glyph has room. */
const HOLE_PULL = 240;
const HOLE_SWIRL = 1.05;
const HOLE_REACH = 60;
const HOLE_GROW = 1.6;
/** Drag on a released cell: heavy, so the spiral is a fall, not an orbit. */
const HOLE_DRAG = 5;
/** Physics runs on fixed substeps: the coupling is stiff enough to blow up on a long frame. */
const SUBSTEP = 1 / 120;
/** The canvas camera's vertical field of view, for projecting the pointer onto a layer. */
export const FIELD_OF_VIEW = 35;

const ICONS = Object.keys(ICON_CODE_POINTS) as IconName[];
export const GLYPHS = ICONS.map((icon) => String.fromCodePoint(ICON_CODE_POINTS[icon]));
const REPEATS = [0, 1];

/** Deterministic layout: every run starts from the same pattern. */
function seeded(index: number): number {
  const value = Math.sin(index * 12.9898 + 78.233) * 43_758.545_3;
  return value - Math.floor(value);
}

export interface IconLayoutOptions {
  readonly rows: number;
  readonly columns: number;
  /** Cell pitch in world units: this alone sets the rhythm, so every icon sits on the same lattice. */
  readonly cell: number;
  readonly iconSize: number;
  readonly depth: number;
  readonly speed: number;
  readonly colour: string;
  /** Colours cells from the gem palette instead of the flat `colour`, cycling on row + column so the bands run
   * diagonally — across the scroll direction, where they read as a moving pattern rather than as noise. */
  readonly gems?: boolean;
  readonly opacity: number;
  /** Distinct motifs; fewer than the available glyphs, so a motif always has a spare glyph to become. */
  readonly motifs: number;
  /** Shifts this layer's lattice into the gaps of the other one, across and down. */
  readonly offset: number;
  readonly rowOffset: number;
  readonly seed: number;
  /** 0 = ignores the pointer, 1 = full push. Lower for deeper layers, which is what makes the parallax read. */
  readonly response: number;
  /** Seconds after the impact before this layer feels it, and how its front travels and shoves. */
  readonly waveDelay: number;
  readonly waveSpeed: number;
  readonly waveImpulse: number;
}

interface CellSpec {
  readonly key: string;
  readonly motif: number;
  readonly colour: string;
  readonly position: Vec3;
  /** Seconds after a motif change before this cell starts its flip. */
  readonly delay: number;
}

export interface Layout {
  readonly cells: readonly CellSpec[];
  readonly restX: Float32Array;
  readonly restY: Float32Array;
  readonly neighbours: Int32Array;
  readonly motifOfCell: Int32Array;
  /** Cell indices grouped by motif, so a motif change never walks the cells it cannot affect. */
  readonly cellsByMotif: readonly (readonly number[])[];
  readonly loop: number;
}

export function buildLayout(layer: IconLayoutOptions): Layout {
  const { rows, columns, cell, colour, gems, motifs, offset, rowOffset, seed } = layer;
  const loop = columns * cell;
  const grid: number[][] = [];
  for (let row = 0; row < rows; row += 1) {
    const line: number[] = [];
    for (let column = 0; column < columns; column += 1) {
      const banned = new Set([line[column - 1], grid[row - 1]?.[column]]);
      let motif = Math.floor(seeded(seed + row * columns + column) * motifs);
      for (let step = 0; step < motifs && banned.has(motif); step += 1) motif = (motif + 1) % motifs;
      line.push(motif);
    }
    grid.push(line);
  }

  const cells: CellSpec[] = [];
  for (const repeat of REPEATS) {
    for (const [row, line] of grid.entries()) {
      for (const [column, motif] of line.entries()) {
        cells.push({
          key: `${repeat}:${row}:${column}`,
          motif,
          colour: gems === true ? (GEM_TONES[(row + column) % GEM_TONES.length] ?? colour) : colour,
          position: [
            // No brick stagger: with alternating rows offset there is no consistent gap for the other sheet to sit in.
            -loop / 2 + repeat * loop + column * cell + offset - cell / 2,
            ((rows - 1) * cell) / 2 - row * cell + rowOffset,
            0,
          ],
          // Each cell starts its flip at its own moment, so a motif change sweeps across rather than blinking at
          // once. Every choice is already present in the retained draw records.
          delay:
            (Math.floor(seeded(seed + 977 + row * columns + column) * STAGGER_STEPS) / STAGGER_STEPS) * STAGGER_SECONDS,
        });
      }
    }
  }

  const perRepeat = rows * columns;
  const neighbours = new Int32Array(cells.length * 4).fill(-1);
  for (const repeat of REPEATS) {
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = repeat * perRepeat + row * columns + column;
        const base = index * 4;
        if (column > 0) neighbours[base] = index - 1;
        if (column < columns - 1) neighbours[base + 1] = index + 1;
        if (row > 0) neighbours[base + 2] = index - columns;
        if (row < rows - 1) neighbours[base + 3] = index + columns;
      }
    }
  }

  return {
    cells,
    restX: Float32Array.from(cells, (entry) => entry.position[0]),
    restY: Float32Array.from(cells, (entry) => entry.position[1]),
    neighbours,
    motifOfCell: Int32Array.from(cells, (entry) => entry.motif),
    cellsByMotif: Array.from({ length: motifs }, (_, motif) =>
      cells.reduce<number[]>((list, entry, index) => {
        if (entry.motif === motif) list.push(index);
        return list;
      }, []),
    ),
    loop,
  };
}

/** Storage is sized once from the immutable lattice; only matrices cross into Glyph. */
export function createLattice(layout: Layout, motifs: number, seed: number) {
  const count = layout.cells.length;
  return {
    x: new Float32Array(count),
    y: new Float32Array(count),
    vx: new Float32Array(count),
    vy: new Float32Array(count),
    accumulator: 0,
    waves: Array.from({ length: MAX_WAVES }, () => ({ start: -Infinity, x: 0, y: 0, scale: 0, radius: 0 })),
    activeWaves: new Int32Array(MAX_WAVES),
    world: mat4.create(),
    inverse: mat4.create(),
    projected: vec3.create(),
    waveCursor: 0,
    seenWave: 0,
    pointer: { x: 0, y: 0, active: false, strength: 0 },
    hole: { x: 0, y: 0, horizon: 1, pull: 0, time: -1 },
    departAt: new Float32Array(count).fill(NaN),
    swallowed: new Uint8Array(count),
    replays: 0,
    selected: Int32Array.from(layout.cells, (cell) => cell.motif % GLYPHS.length),
    previous: Int32Array.from(layout.cells, (cell) => cell.motif % GLYPHS.length),
    motifGlyphs: Int32Array.from({ length: motifs }, (_, index) => index),
    spare: new Int32Array(GLYPHS.length),
    applied: new Uint8Array(count),
    morph: { motif: -1, to: 0, start: 0 },
    nextSwap: 0,
    random: mulberry32.create(seed),
    position: vec3.create(),
    rotation: quat.create(),
    scale: vec3.create(),
    angles: euler.create(),
    matrix: mat4.create(),
  };
}
export type LatticeState = ReturnType<typeof createLattice>;

/** Motifs change on the render clock; no timers, sets, callbacks, or temporary candidate arrays. */
export function advanceMorph(state: LatticeState, layout: Layout, now: number): void {
  const morph = state.morph;
  if (state.nextSwap === 0) state.nextSwap = now + SWAP_INTERVAL * 1000;
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
    state.nextSwap = now + SWAP_INTERVAL * 1000;
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

/** Compose one cell directly; baseline is the precomputed glyph centering offset. */
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
    grow += (HOLE_GROW * loose) / (nearSquared + 0.35);
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
  const limit = open ? HOLE_REACH : MAX_OFFSET;
  let waveCount = 0;
  for (let index = 0; index < state.waves.length; index++) {
    const wave = state.waves[index]!;
    const seconds = (now - wave.start) / 1000;
    if (seconds <= 0 || seconds > WAVE_SECONDS) continue;
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
      const damping = DAMPING + (HOLE_DRAG - DAMPING) * loose;
      let ax = -STIFFNESS * hold * px - damping * (state.vx[index] ?? 0);
      let ay = -STIFFNESS * hold * py - damping * (state.vy[index] ?? 0);

      const base = index * 4;
      for (let link = 0; link < 4; link += 1) {
        const other = layout.neighbours[base + link] ?? -1;
        if (other < 0 || state.swallowed[other] === 1) continue;
        ax += COUPLING * hold * ((state.x[other] ?? 0) - px);
        ay += COUPLING * hold * ((state.y[other] ?? 0) - py);
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
          const force = (HOLE_PULL / (near * near + 0.35) + 70) * loose * gravity;
          const round = swirl(near, HOLE_SWIRL);
          ax += (dx / distance) * force - (dy / distance) * force * round;
          ay += (dy / distance) * force + (dx / distance) * force * round;
        }
      }

      // Indexed, not `for...of`: this is inside the cell loop inside the substep loop, so an iterator here is ten
      // thousand short-lived objects a frame — and the list is empty except in the two seconds after an impact.
      for (let wave = 0; wave < waveCount; wave += 1) {
        const entry = state.waves[state.activeWaves[wave]!];
        if (entry === undefined) continue;
        const dx = restX - entry.x;
        const dy = restY - entry.y;
        const distance = Math.hypot(dx, dy);
        const front = distance - entry.radius;
        const band = Math.exp(-(front * front) / (2 * WAVE_WIDTH * WAVE_WIDTH));
        if (band <= 0.002 || distance <= 0.0001) continue;
        const push = (layer.waveImpulse * entry.scale * band) / (1 + distance * 0.35);
        ax += (dx / distance) * push;
        ay += (dy / distance) * push;
      }

      if (state.pointer.active && state.pointer.strength > 0) {
        const dx = restX + px - state.pointer.x;
        const dy = restY + py - state.pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance < POINTER_RADIUS && distance > 0.0001) {
          const falloff = 1 - distance / POINTER_RADIUS;
          const push = POINTER_FORCE * state.pointer.strength * falloff * falloff;
          ax += (dx / distance) * push;
          ay += (dy / distance) * push;
        }
      }

      const speed = open ? MAX_SPEED * 3 : MAX_SPEED;
      const vx = clamp((state.vx[index] ?? 0) + ax * SUBSTEP, -speed, speed);
      const vy = clamp((state.vy[index] ?? 0) + ay * SUBSTEP, -speed, speed);
      state.vx[index] = vx;
      state.vy[index] = vy;
      state.x[index] = clamp(px + vx * SUBSTEP, -limit, limit);
      state.y[index] = clamp(py + vy * SUBSTEP, -limit, limit);
    }
  }
}
