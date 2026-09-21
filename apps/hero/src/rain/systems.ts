import type { World } from 'koota';
import { vec3 } from 'math';
import { Mode, Viewport } from '../hero/traits';
import { physicsActions } from '../physics/actions';
import { Body } from '../physics/traits';
import { Time } from '../time/traits';
import { jitter } from '../utils';
import { rainActions } from './actions';
import { COUNT, DROP_EVERY, FADE_SECONDS, FALL_GRAVITY, MARGIN, RAIN_AFTER, RELEASE_Z } from './content';
import { Rain, RainView } from './traits';

const spawnPosition = vec3.create();

/**
 * A couple of seconds into play, glyphs start falling from near the camera onto the paper as glass bodies the robot
 * can push. One pushed past the edge is taken away. When every slot is taken, the oldest fades to make room.
 * Leaving play fades them all and stops the rain.
 */
export function rainGlyphs(world: World): void {
  const mode = world.get(Mode)!;
  const time = world.get(Time)!;
  const viewport = world.get(Viewport)!;
  const rain = world.get(Rain)!;
  const raining = mode.kind === 'play' && time.elapsed - mode.since >= RAIN_AFTER;
  let { dropAt, dropped } = rain;
  const dismiss = rainActions(world).dismissDrop;

  for (let slot = 0; slot < COUNT; slot++) {
    const drop = rain.drops[slot]!;

    if (drop.phase === 'fading') {
      drop.age += time.delta;

      if (drop.age >= FADE_SECONDS) drop.phase = 'idle';

      continue;
    }

    if (drop.phase !== 'live') continue;

    if (!raining) {
      dismiss(slot, true);
      continue;
    }

    const body = drop.entity!.get(Body)!;
    drop.x = body.position[0];
    drop.y = body.position[1];
    drop.z = body.position[2];
    drop.yaw = 2 * Math.atan2(body.rotation[2], body.rotation[3]);

    // Landed, it weighs what the letters weigh, so the robot's pushes and the floor's friction feel the same.
    if (body.landed) physicsActions(world).setGravityFactor(drop.entity!, 1);

    if (Math.abs(drop.x) > viewport.width / 2 + MARGIN || Math.abs(drop.y) > viewport.height / 2 + MARGIN)
      dismiss(slot, false);
  }

  if (!raining) dropAt = time.elapsed;
  else if (time.elapsed >= dropAt) {
    let slot = rain.drops.findIndex((drop) => drop.phase === 'idle');

    if (slot < 0) {
      let oldest = Number.POSITIVE_INFINITY;

      for (let index = 0; index < COUNT; index++) {
        const drop = rain.drops[index]!;

        if (drop.phase === 'live' && drop.serial < oldest) {
          oldest = drop.serial;
          slot = index;
        }
      }

      if (slot >= 0) dismiss(slot, true);
    }

    const solid = slot >= 0 ? rain.solids[slot] : undefined;

    if (solid !== undefined) {
      const drop = rain.drops[slot]!;
      const serial = dropped++;
      const size = 0.7 + jitter(serial * 5 + 13) * 0.9;
      vec3.set(
        spawnPosition,
        (jitter(serial * 3 + 1) - 0.5) * viewport.width * 0.9,
        (jitter(serial * 3 + 2) - 0.5) * viewport.height * 0.9,
        RELEASE_Z,
      );
      // The unit solid grows with the glyph in its plane; the thickness is the same for every size.
      const prisms = solid.prisms.map((prism) => prism.map((value, index) => (index % 3 === 2 ? value : value * size)));
      drop.entity = physicsActions(world).spawnSolidBody(spawnPosition, prisms, {
        stacks: true,
        gravityFactor: FALL_GRAVITY,
        airborne: true,
      });
      drop.phase = 'live';
      drop.x = spawnPosition[0];
      drop.y = spawnPosition[1];
      drop.z = spawnPosition[2];
      drop.yaw = 0;
      drop.size = size;
      drop.serial = serial;
      drop.age = 0;
    }

    dropAt = time.elapsed + DROP_EVERY * (0.6 + jitter(dropped * 7) * 0.8);
  }

  world.set(Rain, { dropAt, dropped });
}

/** Copy the drops into their mounted glyph groups, at the body's pose while live and shrinking away while fading. */
export function syncRainViews(world: World): void {
  const groups = world.get(RainView);

  if (groups === undefined) return;

  const { drops } = world.get(Rain)!;

  for (let index = 0; index < COUNT; index++) {
    const group = groups[index];

    if (group == null) continue;

    const drop = drops[index]!;
    group.visible = drop.phase !== 'idle';

    if (!group.visible) continue;

    group.position.set(drop.x, drop.y, drop.z);
    group.rotation.z = drop.yaw;
    const scale = drop.size * (drop.phase === 'fading' ? 1 - drop.age / FADE_SECONDS : 1);
    group.scale.set(scale, scale, 1);
  }
}
