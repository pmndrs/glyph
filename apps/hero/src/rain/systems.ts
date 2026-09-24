import type { World } from 'koota';
import { vec3 } from 'math';
import { Collapse } from '../black-hole/traits';
import { Mode } from '../director/traits';
import { Viewport } from '../viewport/traits';
import { physicsActions } from '../physics/actions';
import { readBodyPose } from '../physics/utils';
import { Body } from '../physics/traits';
import { Robot } from '../robot/traits';
import { Time } from '../time/traits';
import { jitter } from '../utils';
import { rainActions } from './actions';
import { COUNT, DROP_EVERY, EAT_SECONDS, FADE_SECONDS, FALL_GRAVITY, MARGIN, RAIN_AFTER, RELEASE_Z } from './content';
import { flight, type Flight } from '../black-hole/utils';
import { Rain, RainView } from './traits';

const spawnPosition = vec3.create();
const kick = vec3.create();

/**
 * A couple of seconds into play, glyphs start falling from near the camera onto the paper as glass bodies the robot
 * can push. One pushed past the edge is taken away. When every slot is taken, the oldest fades to make room.
 * The finale stops the rain and leaves what has fallen to the hole; leaving play fades them all.
 */
export function rainGlyphs(world: World): void {
  const mode = world.get(Mode)!;
  const time = world.get(Time)!;
  const viewport = world.get(Viewport)!;
  const rain = world.get(Rain)!;
  const beat = world.get(Collapse)!.hole.beat;
  const playing = mode.kind === 'play';
  const raining = playing && time.elapsed - mode.since >= RAIN_AFTER && (beat === 'closed' || beat === 'play');
  let { dropAt, dropped } = rain;
  const dismiss = rainActions(world).dismissDrop;
  const robot = world.queryFirst(Robot)?.get(Robot);

  for (let slot = 0; slot < COUNT; slot++) {
    const drop = rain.drops[slot]!;

    if (drop.phase === 'fading' || drop.phase === 'eaten') {
      drop.age += time.delta;

      if (drop.age >= (drop.phase === 'eaten' ? EAT_SECONDS : FADE_SECONDS)) drop.phase = 'idle';

      continue;
    }

    if (drop.phase !== 'live') continue;

    if (!playing) {
      dismiss(slot, 'fading');
      continue;
    }

    const body = drop.entity!.get(Body)!;
    readBodyPose(drop, drop.entity!);

    // Landed, it weighs what the letters weigh, so the robot's pushes and the floor's friction feel the same.
    if (body.landed) physicsActions(world).setGravityFactor(drop.entity!, 1);

    // A glyph cannot tip, so one that comes to rest on the robot's back would ride it. Flick it off sideways.
    if (robot?.active && drop.z > 2 && riding(drop.x, drop.y, robot.pose)) {
      const dx = drop.x - robot.pose.x;
      const dy = drop.y - robot.pose.y;
      const away = Math.atan2(dy, dx);
      physicsActions(world).kickBody(drop.entity!, vec3.set(kick, Math.cos(away) * 7, Math.sin(away) * 7, 4));
    }

    if (Math.abs(drop.x) > viewport.width / 2 + MARGIN || Math.abs(drop.y) > viewport.height / 2 + MARGIN)
      dismiss(slot, 'idle');
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

      if (leaving >= 0) dismiss(leaving, 'fading');
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

const eating: Flight = { radius: 1, turn: 0, stretch: 1, size: 1 };

/**
 * Copy the drops into their mounted glyph groups: at the body's pose while live, shrinking away while fading, and
 * flying into the hole while eaten, the way the finale's letters do, on a tightening arc, stretched along it and
 * shrinking as it goes.
 */
export function syncRainViews(world: World): void {
  const view = world.get(RainView);

  if (view === undefined) return;

  const { groups } = view;
  const { drops } = world.get(Rain)!;
  const hole = world.get(Collapse)!.hole;

  for (let index = 0; index < COUNT; index++) {
    const group = groups[index];

    if (group == null) continue;

    const drop = drops[index]!;
    group.visible = drop.phase !== 'idle';

    if (!group.visible) continue;

    if (drop.phase === 'eaten') {
      const { radius, turn, stretch, size } = flight(eating, drop.age, 0, EAT_SECONDS);
      const dx = drop.x - hole.x;
      const dy = drop.y - hole.y;
      const cosine = Math.cos(turn);
      const sine = Math.sin(turn);
      const x = hole.x + (dx * cosine - dy * sine) * radius;
      const y = hole.y + (dx * sine + dy * cosine) * radius;
      group.position.set(x, y, drop.z + Math.sin(Math.PI * (1 - size)) * 0.8);
      // Stretched along the arc, which at the end runs straight into the centre.
      group.rotation.z = Math.atan2(y - hole.y, x - hole.x) + turn * 0.5;
      group.scale.set(drop.size * size * stretch, (drop.size * size) / stretch, 1);
      continue;
    }

    group.position.set(drop.x, drop.y, drop.z);
    // Going, a glyph gathers itself for an instant, then scales away.
    const t = drop.phase === 'fading' ? Math.min(drop.age / FADE_SECONDS, 1) : 0;
    const scale = drop.size * (1 + 0.12 * Math.sin(Math.PI * Math.min(t * 2.5, 1))) * (1 - t * t);
    group.rotation.z = drop.yaw;
    group.scale.set(scale, scale, 1);
  }
}
