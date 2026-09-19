import { trait } from 'koota';
import { vec3 } from 'math';
import type { IconLayoutOptions, Layout, LatticeState } from './utils/lattice';

export interface FieldState {
  options: IconLayoutOptions;
  layout: Layout;
  lattice: LatticeState;
  offset: number;
}

export const Field = trait((): FieldState | undefined => undefined);

export const Impacts = trait(() => ({
  entries: Array.from({ length: 16 }, () => ({ id: 0, at: 0, world: vec3.create() })),
  next: 1,
  latest: -1,
}));
