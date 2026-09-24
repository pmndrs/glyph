import { EmberView } from './traits';
import { EMBER_SECONDS, PARTICLES } from './content';
import type { World } from 'koota';
import { Collapse } from '../black-hole/traits';
import { Viewport } from '../viewport/traits';

/** Publish emission transforms and uniforms only while the ember view is mounted. */
export function syncEmberView(world: World): void {
  const view = world.get(EmberView);

  if (view === undefined) return;

  // The embers burn on the pop's clock, and burst from the hole wherever it popped: its floor position brought up
  // to their height on screen.
  const hole = world.get(Collapse)!.hole;
  const since = hole.sincePop ?? -1;
  view.age.value = since;
  const { cameraZ } = world.get(Viewport)!;
  const lift = (cameraZ - 8) / cameraZ;
  const originX = hole.x * lift;
  const originY = hole.y * lift;
  view.bloom.value = since < 0 ? 0.18 : 0.75;

  for (const particle of PARTICLES) {
    const group = view.groups[particle.index];

    if (group === null || group === undefined) continue;

    const age = since - particle.delay;

    // Keep the text mounted and shaped before emission. A near-zero transform hides its prewarmed draw.
    if (age < 0 || age >= EMBER_SECONDS) {
      group.scale.setScalar(0.0001);
      continue;
    }

    const travel = 1 - Math.exp(-age * 9);
    const size = particle.size * Math.min(1, age / 0.035) * (1 - (age / EMBER_SECONDS) ** 1.4 * 0.8);
    group.position.set(originX + particle.reachX * travel, originY + particle.reachY * travel - age * age * 0.25, 8);
    group.rotation.z = particle.angle * 0.3 + age * particle.spin;
    group.scale.setScalar(size);
  }
}
