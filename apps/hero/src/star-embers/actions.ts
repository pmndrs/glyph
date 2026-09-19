import { createActions } from 'koota';
import { StarEmbers } from './traits';

export const starEmberActions = createActions((world) => ({
  initializeStarEmbers() {
    world.add(StarEmbers);
  },
  sampleStarEmbers(age: number | undefined) {
    world.set(StarEmbers, { age: age ?? -1 });
  },
}));
