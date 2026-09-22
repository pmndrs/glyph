import { trait } from 'koota';
import { vec3, type Mat4, type Quat, type Vec3 } from 'math';
import type { Mulberry32 } from 'math/random';
import type { Glyphs } from '@pmndrs/glyph/three';
import type { Group, Matrix4 } from 'three/webgpu';

export interface IconLayoutOptions {
  readonly rows: number;
  readonly columns: number;
  /** Cell pitch in world units: this alone sets the rhythm, so every icon sits on the same lattice. */
  readonly cell: number;
  readonly iconSize: number;
  /** Height above the floor. The two sheets are a hair apart so they never fight for the same depth. */
  readonly height: number;
  readonly speed: number;
  readonly colour: string;
  /** Cycle gem colors diagonally across the scroll direction. */
  readonly gems?: boolean;
  readonly opacity: number;
  /** Distinct motifs. Fewer than the available glyphs, so a motif always has a spare glyph to become. */
  readonly motifs: number;
  /** Shifts this sheet's lattice into the gaps of the other one, across and down. */
  readonly offset: number;
  readonly rowOffset: number;
  readonly seed: number;
  /** 0 = ignores the robot, 1 = full shove. Lower for the finer sheet, which is what makes the two read apart. */
  readonly response: number;
  /** Seconds after a shock before this sheet feels it, and how its front travels and shoves. */
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
  /** The robot, in this sheet's own frame, and how hard it is pressing on it. */
  presser: { x: number; y: number; active: boolean; strength: number };
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
  matrix: Mat4;
}

export const IconField = trait({
  options: (): IconLayoutOptions | undefined => undefined,
  layout: (): Layout | undefined => undefined,
  lattice: (): LatticeState | undefined => undefined,
  offset: 0,
});

export const Shocks = trait({
  entries: () => Array.from({ length: 8 }, () => ({ id: 0, at: 0, world: vec3.create() })),
  next: 1,
  latest: -1,
});

export interface IconDraw {
  group: Group;
  glyphs: Glyphs;
  baselines: Float64Array;
  hidden: Matrix4;
  matrix: Matrix4;
  /** Each cell's matrix as last written to its glyph, so a cell that has not moved uploads nothing. */
  written: Float64Array;
}

export const IconView = trait((): IconDraw | undefined => undefined);
