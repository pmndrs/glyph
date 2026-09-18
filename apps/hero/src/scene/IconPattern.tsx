import { Text, TextGroup } from '@pmndrs/glyph/react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Vector3, type Group } from 'three/webgpu';

import { ICON_CODE_POINTS, type IconName, type Vec3 } from '../content';
import type { Faces, SlugFont } from '../fonts';
import { GEM_TONES } from '../materials/gems';
import { pattern } from '../materials/ink';
import { shockwaves } from './shockwave';

/** Scroll direction, as an angle from the x axis. Both layers share it, so the field moves as one. */
export const PATTERN_ANGLE = -0.32;
const ANGLE = PATTERN_ANGLE;
/** How long one flip takes, and the window over which a motif's cells start theirs. */
const MORPH_SECONDS = 0.32;
const STAGGER_SECONDS = 0.5;
/**
 * Start times are quantised to this many steps across the stagger window. Each distinct start time costs one React
 * re-render of the whole layer, and a continuous spread cost one on nearly every frame of the window — tens of
 * thousands of elements per motif change, which is enough garbage to show as collection pauses. Steps this far apart
 * still overlap heavily inside a 0.32s flip, so the sweep reads the same.
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
const POINTER_FADE = 0.16;

/** Bounds: a cell never leaves its own neighbourhood, whatever the wave does. */
const MAX_OFFSET = 2.4;
const MAX_SPEED = 26;
/** Physics runs on fixed substeps: the coupling is stiff enough to blow up on a long frame. */
const SUBSTEP = 1 / 120;
/** The canvas camera's vertical field of view, for projecting the pointer onto a layer. */
const FIELD_OF_VIEW = 35;

const ICONS = Object.keys(ICON_CODE_POINTS) as IconName[];
const GLYPHS = ICONS.map((icon) => String.fromCodePoint(ICON_CODE_POINTS[icon]));
const REPEATS = [0, 1];

/** Deterministic layout: every run starts from the same pattern. */
function seeded(index: number): number {
  const value = Math.sin(index * 12.9898 + 78.233) * 43_758.545_3;
  return value - Math.floor(value);
}

export interface IconLayer {
  readonly faces: Faces;
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

interface Layout {
  readonly cells: readonly CellSpec[];
  readonly restX: Float32Array;
  readonly restY: Float32Array;
  readonly neighbours: Int32Array;
  readonly motifOfCell: Int32Array;
  /** Cell indices grouped by motif, so a motif change never walks the cells it cannot affect. */
  readonly cellsByMotif: readonly (readonly number[])[];
  readonly loop: number;
}

function buildLayout(layer: IconLayer): Layout {
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
          // once — which also spreads the paragraph reshaping across frames instead of stalling one.
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

interface Morph {
  readonly motif: number;
  readonly to: string;
  readonly start: number;
  /** Cells that have already taken the new glyph; the rest are still mid-flip or waiting. */
  readonly applied: Set<number>;
}

interface LatticeState {
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  accumulator: number;
  /** Rings in flight, each from one letter's impact, in sheet space. */
  waves: { start: number; x: number; y: number; scale: number }[];
  /** Highest impact id already taken into `waves`. */
  seenWave: number;
  pointer: { x: number; y: number; active: boolean; strength: number };
}

/**
 * One monogram layer: icons on a lattice, the sheet rotated and scrolled so it runs forever, and the lattice itself a
 * mass–spring net that an impact — or the pointer — pushes around. Cells carry a motif, so a change sweeps every icon
 * of that type, each taking its new glyph as it turns edge-on.
 */
export function IconPattern(layer: IconLayer) {
  const { faces, cell, iconSize, depth, speed, opacity, motifs, response } = layer;
  const layout = useMemo(() => buildLayout(layer), [layer]);
  const count = layout.cells.length;

  const [glyphs, setGlyphs] = useState<readonly string[]>(() =>
    layout.cells.map((entry) => GLYPHS[entry.motif % GLYPHS.length] ?? ''),
  );
  const sheet = useRef<Group>(null);
  const offset = useRef(0);
  const morph = useRef<Morph | undefined>(undefined);
  const motifGlyphs = useRef<string[]>(GLYPHS.slice(0, motifs));
  const cellGroups = useRef<(Group | undefined)[]>([]);
  const scratch = useRef(new Vector3());
  // The frame pointer defaults to screen centre, so without this the lattice is stirred before the mouse is touched.
  const pointerStrength = useRef(0);
  const state = useRef<LatticeState>({
    x: new Float32Array(count),
    y: new Float32Array(count),
    vx: new Float32Array(count),
    vy: new Float32Array(count),
    accumulator: 0,
    waves: [],
    seenWave: 0,
    pointer: { x: 0, y: 0, active: false, strength: 0 },
  });
  const camera = useThree((three) => three.camera);

  useEffect(() => {
    const moved = () => {
      pointerStrength.current = 1;
    };
    const left = () => {
      pointerStrength.current = 0;
    };
    window.addEventListener('pointermove', moved, { passive: true });
    window.addEventListener('pointerleave', left, { passive: true });
    return () => {
      window.removeEventListener('pointermove', moved);
      window.removeEventListener('pointerleave', left);
    };
  }, []);

  const register = useCallback((index: number, group: Group | null) => {
    cellGroups.current[index] = group ?? undefined;
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (morph.current !== undefined) return;
      const current = motifGlyphs.current;
      const motif = Math.floor(Math.random() * motifs);
      const spare = GLYPHS.filter((glyph) => !current.includes(glyph));
      const to = spare[Math.floor(Math.random() * spare.length)];
      if (to === undefined) return;
      current[motif] = to;
      morph.current = { motif, to, start: performance.now(), applied: new Set() };
    }, SWAP_INTERVAL * 1000);
    return () => {
      clearInterval(timer);
    };
  }, [motifs]);

  useFrame(({ pointer }, delta) => {
    const group = sheet.current;
    if (group === null) return;
    const step = Math.min(delta, 0.05);

    offset.current = (offset.current + step * speed) % layout.loop;
    group.position.x = -offset.current;

    collectWaves(group, state.current, layer.waveDelay);
    // Movement sets the strength; stillness lets it fall away within a fraction of a second.
    pointerStrength.current *= Math.exp(-step / POINTER_FADE);
    if (pointerStrength.current < 0.01) pointerStrength.current = 0;
    state.current.pointer.strength = pointerStrength.current * response;
    trackPointer(group, camera.position.z, pointer, scratch.current, state.current.pointer, response);
    simulate(state.current, layout, step, layer);
    applyStagger(morph, layout, setGlyphs);
    writeCells(cellGroups.current, layout, state.current, morph.current);
  });

  return (
    <group position={[0, 0, depth]} rotation-z={ANGLE}>
      <group ref={sheet}>
        <TextGroup name={`icon-pattern-${String(depth)}`}>
          {layout.cells.map((entry, index) => (
            <Cell
              cell={cell}
              colour={entry.colour}
              font={faces.icons}
              icon={glyphs[index] ?? ''}
              iconSize={iconSize}
              index={index}
              key={entry.key}
              opacity={opacity}
              position={entry.position}
              register={register}
            />
          ))}
        </TextGroup>
      </group>
    </group>
  );
}

const impact = new Vector3();

/**
 * Takes every impact published since the last frame into the sheet's own space, where the lattice lives. A batch that
 * arrives together — the title's letters — has its strength divided across the batch, so a five-letter word disturbs
 * the sheet about as hard as one impact did, but in the shape of the word.
 */
function collectWaves(sheet: Group, state: LatticeState, delay: number): void {
  const pending = shockwaves();
  let batch = 0;
  for (let index = 0; index < pending.length; index += 1) if ((pending[index]?.id ?? 0) > state.seenWave) batch += 1;
  if (batch === 0) return;
  const scale = 1 / Math.sqrt(batch);
  for (let index = 0; index < pending.length; index += 1) {
    const shock = pending[index];
    if (shock === undefined || shock.id <= state.seenWave) continue;
    state.seenWave = shock.id;
    impact.set(shock.world[0], shock.world[1], shock.world[2]);
    sheet.worldToLocal(impact);
    // Deeper layers answer a beat later, so the impact travels through the stack instead of striking it flat.
    state.waves.push({ start: shock.at + delay * 1000, x: impact.x, y: impact.y, scale });
    if (state.waves.length > MAX_WAVES) state.waves.shift();
  }
}

/** Projects the pointer onto this layer's plane and stores it in sheet space. */
function trackPointer(
  sheet: Group,
  cameraZ: number,
  pointer: { x: number; y: number },
  scratch: Vector3,
  target: LatticeState['pointer'],
  response: number,
): void {
  if (response <= 0) {
    target.active = false;
    return;
  }
  sheet.updateWorldMatrix(true, false);
  const depth = sheet.getWorldPosition(scratch).z;
  const distance = cameraZ - depth;
  const halfHeight = Math.tan((FIELD_OF_VIEW * Math.PI) / 360) * distance;
  const halfWidth = halfHeight * (globalThis.innerWidth / Math.max(globalThis.innerHeight, 1));
  scratch.set(pointer.x * halfWidth, pointer.y * halfHeight, depth);
  sheet.worldToLocal(scratch);
  target.x = scratch.x;
  target.y = scratch.y;
  target.active = true;
}

/** Fixed-step integration: spring home, damping, neighbour coupling, the travelling ring, and the pointer. */
function simulate(state: LatticeState, layout: Layout, delta: number, layer: IconLayer): void {
  const count = layout.cells.length;
  state.accumulator += delta;
  let guard = 0;
  while (state.accumulator >= SUBSTEP && guard < 8) {
    state.accumulator -= SUBSTEP;
    guard += 1;
    const now = performance.now();
    for (let index = state.waves.length - 1; index >= 0; index -= 1) {
      const wave = state.waves[index];
      if (wave !== undefined && (now - wave.start) / 1000 > WAVE_SECONDS) state.waves.splice(index, 1);
    }

    const waveCount = state.waves.length;
    for (let index = 0; index < count; index += 1) {
      const px = state.x[index] ?? 0;
      const py = state.y[index] ?? 0;
      let ax = -STIFFNESS * px - DAMPING * (state.vx[index] ?? 0);
      let ay = -STIFFNESS * py - DAMPING * (state.vy[index] ?? 0);

      const base = index * 4;
      for (let link = 0; link < 4; link += 1) {
        const other = layout.neighbours[base + link] ?? -1;
        if (other < 0) continue;
        ax += COUPLING * ((state.x[other] ?? 0) - px);
        ay += COUPLING * ((state.y[other] ?? 0) - py);
      }

      const restX = layout.restX[index] ?? 0;
      const restY = layout.restY[index] ?? 0;

      // Indexed, not `for...of`: this is inside the cell loop inside the substep loop, so an iterator here is ten
      // thousand short-lived objects a frame — and the list is empty except in the two seconds after an impact.
      for (let wave = 0; wave < waveCount; wave += 1) {
        const entry = state.waves[wave];
        if (entry === undefined) continue;
        const seconds = (now - entry.start) / 1000;
        if (seconds <= 0) continue;
        const radius = layer.waveSpeed * seconds;
        const dx = restX - entry.x;
        const dy = restY - entry.y;
        const distance = Math.hypot(dx, dy);
        const front = distance - radius;
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

      const vx = clamp((state.vx[index] ?? 0) + ax * SUBSTEP, MAX_SPEED);
      const vy = clamp((state.vy[index] ?? 0) + ay * SUBSTEP, MAX_SPEED);
      state.vx[index] = vx;
      state.vy[index] = vy;
      state.x[index] = clamp(px + vx * SUBSTEP, MAX_OFFSET);
      state.y[index] = clamp(py + vy * SUBSTEP, MAX_OFFSET);
    }
  }
}

function clamp(value: number, limit: number): number {
  return value > limit ? limit : value < -limit ? -limit : value;
}

/** Reused across frames and layers: this runs every frame, and a fresh array each time is needless garbage. */
const ready: number[] = [];

/** Gives the new glyph to each cell of the changing motif as that cell turns edge-on, a few cells per frame. */
function applyStagger(
  morph: { current: Morph | undefined },
  layout: Layout,
  setGlyphs: (update: (glyphs: readonly string[]) => readonly string[]) => void,
): void {
  const current = morph.current;
  if (current === undefined) return;
  const elapsed = (performance.now() - current.start) / 1000;
  ready.length = 0;
  const members = layout.cellsByMotif[current.motif];
  if (members === undefined) return;
  for (let position = 0; position < members.length; position += 1) {
    const index = members[position];
    if (index === undefined) continue;
    if (current.applied.has(index)) continue;
    const entry = layout.cells[index];
    if (entry === undefined || elapsed < entry.delay + MORPH_SECONDS / 2) continue;
    current.applied.add(index);
    ready.push(index);
  }
  if (ready.length > 0) {
    setGlyphs((glyphs) => {
      const next = [...glyphs];
      for (const index of ready) next[index] = current.to;
      return next;
    });
  }
  if (elapsed > STAGGER_SECONDS + MORPH_SECONDS) morph.current = undefined;
}

/** Every cell's position and flip angle, written from simulation state each frame rather than held on the cell. */
function writeCells(
  groups: readonly (Group | undefined)[],
  layout: Layout,
  state: LatticeState,
  morph: Morph | undefined,
): void {
  const elapsed = morph === undefined ? 0 : (performance.now() - morph.start) / 1000;
  for (let index = 0; index < layout.cells.length; index += 1) {
    const group = groups[index];
    if (group === undefined) continue;
    group.position.x = (layout.restX[index] ?? 0) + (state.x[index] ?? 0);
    group.position.y = (layout.restY[index] ?? 0) + (state.y[index] ?? 0);
    group.rotation.y = flipAngle(layout, index, morph, elapsed);
  }
}

/** Turn to edge-on, exchange the glyph while it cannot be seen, then turn back facing forward. */
function flipAngle(layout: Layout, index: number, morph: Morph | undefined, elapsed: number): number {
  if (morph === undefined || layout.motifOfCell[index] !== morph.motif) return 0;
  const entry = layout.cells[index];
  if (entry === undefined) return 0;
  const progress = (elapsed - entry.delay) / MORPH_SECONDS;
  if (progress <= 0 || progress >= 1) return 0;
  const half = progress < 0.5 ? progress / 0.5 : (progress - 0.5) / 0.5;
  return progress < 0.5 ? (Math.PI / 2) * half : -(Math.PI / 2) * (1 - half);
}

/** Memoised so a motif change re-renders only the cells that have just taken their new glyph. */
const Cell = memo(function Cell({
  cell,
  colour,
  font,
  icon,
  iconSize,
  index,
  opacity,
  position,
  register,
}: {
  readonly cell: number;
  readonly colour: string;
  readonly font: SlugFont;
  readonly icon: string;
  readonly iconSize: number;
  readonly index: number;
  readonly opacity: number;
  readonly position: Vec3;
  readonly register: (index: number, group: Group | null) => void;
}) {
  return (
    <group position={position} ref={(group) => register(index, group)}>
      <Text
        constraints={{ width: { mode: 'exact', size: cell } }}
        font={font}
        layout={{ align: 'center', wrap: 'none' }}
        material={pattern}
        // Centred on the group origin, so the flip turns about the icon rather than its paragraph's left edge.
        position={[-cell / 2, iconSize / 2, 0]}
        style={{ color: colour, fontSize: iconSize, lineHeight: 1, opacity }}
      >
        {icon}
      </Text>
    </group>
  );
});
