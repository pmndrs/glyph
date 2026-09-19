import { trait } from 'koota';
import { vec3 } from 'math';
import type { IconLayoutOptions, Layout, LatticeState } from './utils/lattice';

export const Field = trait({
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
