import { createActions } from 'koota';
import { vec3 } from 'math';
import { Time } from '../time/traits';
import { IconField, Impacts } from './traits';
import { buildLayout, createLattice, type IconLayoutOptions } from './utils/lattice';

export const iconFieldActions = createActions((world) => ({
  spawnIconFields() {
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
  impactIconFields(x: number, y: number, z: number) {
    const impacts = world.get(Impacts)!;
    impacts.latest = (impacts.latest + 1) % impacts.entries.length;
    const impact = impacts.entries[impacts.latest]!;
    impact.id = impacts.next++;
    impact.at = world.get(Time)!.now;
    vec3.set(impact.world, x, y, z);
    world.set(Impacts, { latest: impacts.latest, next: impacts.next });
  },
  resetIconFields() {
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
