import { createActions } from 'koota';
import { euler, mat4, quat, vec3 } from 'math';
import { mulberry32 } from 'math/random';
import { jitter } from '../random';
import { Time } from '../time/traits';
import { IconField, Impacts, type IconLayoutOptions, type Layout, type LatticeState } from './traits';
import { GLYPHS, GEM_TONES, STAGGER_STEPS, STAGGER_SECONDS } from './content';

const REPEATS = [0, 1];

export const iconFieldActions = createActions((world) => ({
  spawnIconFields: () => {
    // Pitch and speed scale together with depth, preserving the sheets' interleave.
    const layers: readonly IconLayoutOptions[] = [
      {
        cell: 2.202,
        colour: '#a8adb6',
        gems: true,
        columns: 18,
        depth: -9.5,
        iconSize: 0.42,
        motifs: 7,
        offset: 1.101,
        opacity: 1,
        response: 0.35,
        rowOffset: 0,
        rows: 13,
        seed: 4201,
        speed: 3.709,
        waveDelay: 0.13,
        waveImpulse: 87,
        waveSpeed: 11,
      },
      {
        cell: 1.9,
        colour: '#4e535b',
        columns: 20,
        depth: -6,
        iconSize: 0.78,
        motifs: 8,
        offset: 0,
        opacity: 1,
        response: 1,
        rowOffset: 0,
        rows: 16,
        seed: 0,
        speed: 3.2,
        waveDelay: 0,
        waveImpulse: 146,
        waveSpeed: 15,
      },
    ];

    for (const options of layers) {
      const layout = buildLayout(options);
      world.spawn(
        IconField({ options, layout, lattice: createLattice(layout, options.motifs, options.seed), offset: 0 }),
      );
    }
  },
  impactIconFields: (x: number, y: number, z: number) => {
    const impacts = world.get(Impacts)!;
    impacts.latest = (impacts.latest + 1) % impacts.entries.length;
    const impact = impacts.entries[impacts.latest]!;
    impact.id = impacts.next++;
    impact.at = world.get(Time)!.now;
    vec3.set(impact.world, x, y, z);
    world.set(Impacts, { latest: impacts.latest, next: impacts.next });
  },
  resetIconFields: () => {
    world.query(IconField).updateEach(([field]) => {
      const lattice = field.lattice!;
      lattice.swallowed.fill(0);
      lattice.x.fill(0);
      lattice.y.fill(0);
      lattice.vx.fill(0);
      lattice.vy.fill(0);
      lattice.departAt.fill(Number.NaN);
    });
  },
}));

export function buildLayout(layer: IconLayoutOptions): Layout {
  const { rows, columns, cell, colour, gems, motifs, offset, rowOffset, seed } = layer;
  const loop = columns * cell;
  const grid: number[][] = [];

  for (let row = 0; row < rows; row += 1) {
    const line: number[] = [];

    for (let column = 0; column < columns; column += 1) {
      const banned = new Set([line[column - 1], grid[row - 1]?.[column]]);
      let motif = Math.floor(jitter(seed + row * columns + column) * motifs);

      for (let step = 0; step < motifs && banned.has(motif); step += 1) motif = (motif + 1) % motifs;

      line.push(motif);
    }

    grid.push(line);
  }

  const cells: Layout['cells'][number][] = [];

  for (const repeat of REPEATS) {
    for (const [row, line] of grid.entries()) {
      for (const [column, motif] of line.entries()) {
        cells.push({
          key: `${repeat}:${row}:${column}`,
          motif,
          colour: gems === true ? (GEM_TONES[(row + column) % GEM_TONES.length] ?? colour) : colour,
          position: [
            // Aligned rows leave consistent gaps for the second sheet.
            -loop / 2 + repeat * loop + column * cell + offset - cell / 2,
            ((rows - 1) * cell) / 2 - row * cell + rowOffset,
            0,
          ],
          // Stagger motif flips across the sheet using retained glyph records.
          delay:
            (Math.floor(jitter(seed + 977 + row * columns + column) * STAGGER_STEPS) / STAGGER_STEPS) * STAGGER_SECONDS,
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

/** Storage is sized once from the immutable lattice. Only matrices cross into Glyph. */
export function createLattice(layout: Layout, motifs: number, seed: number): LatticeState {
  const count = layout.cells.length;
  const waves = Array.from({ length: 12 }, () => ({ start: -Infinity, x: 0, y: 0, scale: 0, radius: 0 }));

  return {
    x: new Float32Array(count),
    y: new Float32Array(count),
    vx: new Float32Array(count),
    vy: new Float32Array(count),
    accumulator: 0,
    waves,
    activeWaves: new Int32Array(waves.length),
    world: mat4.create(),
    inverse: mat4.create(),
    projected: vec3.create(),
    waveCursor: 0,
    seenWave: 0,
    pointer: { x: 0, y: 0, active: false, strength: 0 },
    hole: { x: 0, y: 0, horizon: 1, pull: 0, time: -1 },
    departAt: new Float32Array(count).fill(NaN),
    swallowed: new Uint8Array(count),
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
