import type { World } from 'koota';
import { vec3 } from 'math';
import { Mode, Viewport } from '../hero/traits';
import { physicsActions } from '../physics/actions';
import { Body } from '../physics/traits';
import { Robot } from '../robot/traits';
import { Time } from '../time/traits';
import { jitter } from '../utils';
import { rainActions } from './actions';
import { COUNT, DROP_EVERY, FADE_SECONDS, FALL_GRAVITY, MARGIN, RAIN_AFTER, RELEASE_Z } from './content';
import { Rain, RainView } from './traits';

const spawnPosition = vec3.create();
const kick = vec3.create();

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
  const robot = world.queryFirst(Robot)?.get(Robot);

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

    // A glyph cannot tip, so one that comes to rest on the robot's back would ride it. Flick it off sideways.
    if (robot?.active && drop.z > 2 && riding(drop.x, drop.y, robot.footprint)) {
      const dx = drop.x - robot.footprint.x;
      const dy = drop.y - robot.footprint.y;
      const away = Math.atan2(dy, dx);
      physicsActions(world).kickBody(drop.entity!, vec3.set(kick, Math.cos(away) * 7, Math.sin(away) * 7, 4));
    }

    if (Math.abs(drop.x) > viewport.width / 2 + MARGIN || Math.abs(drop.y) > viewport.height / 2 + MARGIN)
      dismiss(slot, false);
  }

  if (!raining) dropAt = time.elapsed;
  else if (time.elapsed >= dropAt) {
    const slot = rain.drops.findIndex((drop) => drop.phase === 'idle');

    // With every slot taken, the oldest glyph goes first, and the next drop waits for its slot to free up.
    if (slot < 0 && !rain.drops.some((drop) => drop.phase === 'fading')) {
      let oldest = Number.POSITIVE_INFINITY;
      let leaving = -1;

      for (let index = 0; index < COUNT; index++) {
        const drop = rain.drops[index]!;

        if (drop.phase === 'live' && drop.serial < oldest) {
          oldest = drop.serial;
          leaving = index;
        }
      }

      if (leaving >= 0) dismiss(leaving, true);
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
      // Each glyph falls at its own angle, turning a little, so no two look alike.
      const yaw = jitter(serial * 5 + 17) * Math.PI * 2;
      drop.entity = physicsActions(world).spawnSolidBody(spawnPosition, prisms, {
        stacks: true,
        gravityFactor: FALL_GRAVITY,
        airborne: true,
        yaw,
        spin: (jitter(serial * 5 + 19) - 0.5) * 3,
      });
      drop.phase = 'live';
      drop.x = spawnPosition[0];
      drop.y = spawnPosition[1];
      drop.z = spawnPosition[2];
      drop.yaw = yaw;
      drop.size = size;
      drop.serial = serial;
      drop.age = 0;
      dropAt = time.elapsed + DROP_EVERY * (0.6 + jitter(dropped * 7) * 0.8);
    }
  }

  world.set(Rain, { dropAt, dropped });
}

/** Whether a point over the floor lies within the robot's footprint, with a little room around it. */
function riding(x: number, y: number, footprint: { x: number; y: number; heading: number }): boolean {
  const dx = x - footprint.x;
  const dy = y - footprint.y;
  const cos = Math.cos(footprint.heading);
  const sin = Math.sin(footprint.heading);

  return Math.abs(dx * cos + dy * sin) < 1.3 && Math.abs(dy * cos - dx * sin) < 1.7;
}

/** Copy the drops into their mounted glyph groups, at the body's pose while live and shrinking away while fading. */
export function syncRainViews(world: World): void {
  const view = world.get(RainView);

  if (view === undefined) return;

  const { groups } = view;
  const { drops } = world.get(Rain)!;

  for (let index = 0; index < COUNT; index++) {
    const group = groups[index];

    if (group == null) continue;

    const drop = drops[index]!;
    group.visible = drop.phase !== 'idle';

    if (!group.visible) continue;

    group.position.set(drop.x, drop.y, drop.z);
    // Going, a glyph gathers itself for an instant, then scales away.
    const t = drop.phase === 'fading' ? Math.min(drop.age / FADE_SECONDS, 1) : 0;
    const scale = drop.size * (1 + 0.12 * Math.sin(Math.PI * Math.min(t * 2.5, 1))) * (1 - t * t);
    group.rotation.z = drop.yaw;
    group.scale.set(scale, scale, 1);
  }
}
