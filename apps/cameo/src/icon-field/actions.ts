import { createActions, type Entity } from 'koota';
import { mat4, quat, vec3 } from 'math';
import { mulberry32 } from 'math/random';
import { Time } from '../time/traits';
import { jitter } from '../utils';
import { GEM_TONES, GLYPHS, STAGGER_SECONDS, STAGGER_STEPS } from './content';
import {
  IconField,
  IconView,
  Shocks,
  type IconDraw,
  type IconLayoutOptions,
  type Layout,
  type LatticeState,
} from './traits';

const REPEATS = [0, 1];

export const iconFieldActions = createActions((world) => ({
  mountIconView: (entity: Entity, view: IconDraw) => {
    entity.add(IconView(view));
  },
  unmountIconView: (entity: Entity) => {
    entity.remove(IconView);
  },
  /**
   * Two sheets lie on the floor: a fine gem-toned one and a coarse dark one over it, their lattices offset into
   * each other's gaps and scrolling at their own speeds, which is what gives a flat floor its depth.
   */
  spawnIconField: () => {
    const sheets: readonly IconLayoutOptions[] = [
      {
        cell: 2.6,
        colour: '#a8adb6',
        columns: 18,
        gems: true,
        height: 0.012,
        iconSize: 0.5,
        motifs: 7,
        offset: 1.3,
        opacity: 1,
        response: 0.35,
        rowOffset: 0,
        rows: 18,
        seed: 4201,
        speed: 1.9,
        waveDelay: 0.13,
        waveImpulse: 132,
        waveSpeed: 11,
      },
      {
        cell: 2.25,
        colour: '#5c616a',
        columns: 20,
        height: 0.026,
        iconSize: 0.92,
        motifs: 8,
        offset: 0,
        opacity: 1,
        response: 1,
        rowOffset: 0,
        rows: 20,
        seed: 0,
        speed: 1.6,
        waveDelay: 0,
        waveImpulse: 215,
        waveSpeed: 15,
      },
    ];

    for (const options of sheets) {
      const layout = buildLayout(options);
      world.spawn(
        IconField({ options, layout, lattice: createLattice(layout, options.motifs, options.seed), offset: 0 }),
      );
    }
  },
  /** A thump on the floor at a world point, which every sheet answers with a travelling ring. */
  shockIconField: (x: number, y: number) => {
    const shocks = world.get(Shocks)!;
    shocks.latest = (shocks.latest + 1) % shocks.entries.length;
    const shock = shocks.entries[shocks.latest]!;
    shock.id = shocks.next++;
    shock.at = world.get(Time)!.now;
    vec3.set(shock.world, x, y, 0);
    world.set(Shocks, { latest: shocks.latest, next: shocks.next });
  },
}));

export function buildLayout(sheet: IconLayoutOptions): Layout {
  const { rows, columns, cell, colour, gems, motifs, offset, rowOffset, seed } = sheet;
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
    presser: { x: 0, y: 0, active: false, strength: 0 },
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
    matrix: mat4.create(),
  };
}
