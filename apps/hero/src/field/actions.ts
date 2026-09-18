import { createActions } from 'koota';
import { vec3 } from 'math';
import { Time } from '../time/traits';
import { Field, Impacts, LAYERS, createField } from './traits';

export const fieldActions = createActions((world) => ({
  spawn() {
    for (const options of LAYERS) world.spawn(Field(createField(options)));
  },
  impact(x: number, y: number, z: number) {
    const impacts = world.get(Impacts)!;
    impacts.latest = (impacts.latest + 1) % impacts.entries.length;
    const impact = impacts.entries[impacts.latest]!;
    impact.id = impacts.next++;
    impact.at = world.get(Time)!.now;
    vec3.set(impact.world, x, y, z);
  },
  reset() {
    world.query(Field).updateEach(([field]) => {
      const lattice = field.lattice;
      lattice.swallowed.fill(0);
      lattice.x.fill(0);
      lattice.y.fill(0);
      lattice.vx.fill(0);
      lattice.vy.fill(0);
      lattice.departAt.fill(Number.NaN);
    });
  },
}));
