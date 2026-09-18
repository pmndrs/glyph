import { trait } from 'koota';
import { buildLayout, createLattice, type IconLayoutOptions } from './lattice';

/** Pitch and speed scale together with depth, preserving the two sheets' interleave. */
export const LAYERS: readonly IconLayoutOptions[] = [
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
export function createField(options: IconLayoutOptions) {
  const layout = buildLayout(options);
  return { options, layout, lattice: createLattice(layout, options.motifs, options.seed), offset: 0 };
}
export const Field = trait(() => createField(LAYERS[0]!));
