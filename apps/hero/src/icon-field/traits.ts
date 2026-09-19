import { trait } from 'koota';
import { vec3, type Mat4, type Vec3, type Quat, type Euler } from 'math';
import type { Mulberry32 } from 'math/random';

export interface IconLayoutOptions {
  readonly rows: number;
  readonly columns: number;
  /** Cell pitch in world units: this alone sets the rhythm, so every icon sits on the same lattice. */
  readonly cell: number;
  readonly iconSize: number;
  readonly depth: number;
  readonly speed: number;
  readonly colour: string;
  /** Cycle gem colors diagonally across the scroll direction. */
  readonly gems?: boolean;
  readonly opacity: number;
  /** Distinct motifs. Fewer than the available glyphs, so a motif always has a spare glyph to become. */
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
  readonly position: readonly [x: number, y: number, z: number];
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

export interface LatticeState {
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  accumulator: number;
  waves: { start: number; x: number; y: number; scale: number; radius: number }[];
  activeWaves: Int32Array;
  world: Mat4;
  inverse: Mat4;
  projected: Vec3;
  waveCursor: number;
  seenWave: number;
  pointer: { x: number; y: number; active: boolean; strength: number };
  hole: { x: number; y: number; horizon: number; pull: number; time: number };
  departAt: Float32Array;
  swallowed: Uint8Array;
  selected: Int32Array;
  previous: Int32Array;
  motifGlyphs: Int32Array;
  spare: Int32Array;
  applied: Uint8Array;
  morph: { motif: number; to: number; start: number };
  nextSwap: number;
  random: Mulberry32;
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
  angles: Euler;
  matrix: Mat4;
}

export const IconField = trait({
  options: (): IconLayoutOptions | undefined => undefined,
  layout: (): Layout | undefined => undefined,
  lattice: (): LatticeState | undefined => undefined,
  offset: 0,
});

export const Impacts = trait({
  entries: () => Array.from({ length: 16 }, () => ({ id: 0, at: 0, world: vec3.create() })),
  next: 1,
  latest: -1,
});
