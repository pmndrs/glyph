import type { World } from 'koota';
import { clamp } from 'math';
import { spring2 } from 'math/time';
import { pageActions } from '../page/actions';
import { Letterpress, Script, Spread } from '../page/traits';
import { BODY, BODY_HEIGHT, BODY_ORIGIN, REST, SPRING, pageToWorldX, pageToWorldY } from '../page/utils';
import { physicsActions } from '../physics/actions';
import { Physics } from '../physics/traits';
import { buildCollider, type Collider } from '../physics/utils';
import { TIERS } from '../quality/content';
import { Quality } from '../quality/traits';
import { Time } from '../time/traits';
import { jitter } from '../utils';
import { stoneActions } from './actions';
import {
  CAPTURE_RATE,
  CAPTURE_REACH,
  CLEARANCE,
  HORIZON_ON_PLANE,
  PULL,
  STONE_BOUNCE,
  STONE_FRICTION,
  SWIRL,
} from './content';
import { Stone, StoneView, Taken } from './traits';

const lead = spring2.create();
const leadTarget: [number, number] = [0, 0];
const colliders = new Map<number, Collider>();

/**
 * Move the stone: led, it follows its lead on a critically damped spring, so a hand or the script's path draws it
 * along with weight; let go, it coasts, slows, and bounces off the edges of the text. Its presence eases in and
 * out, its disk turns, and its heat cools.
 */
export function moveStone(world: World): void {
  const stone = world.get(Stone)!;
  const { delta } = world.get(Time)!;
  let { x, y, vx, vy } = stone;

  if (stone.leadX !== undefined && stone.leadY !== undefined) {
    lead.value[0] = x;
    lead.value[1] = y;
    lead.velocity[0] = vx;
    lead.velocity[1] = vy;
    leadTarget[0] = stone.leadX;
    leadTarget[1] = stone.leadY;
    spring2.damp(lead, leadTarget, 0.32, delta);
    [x, y] = lead.value;
    [vx, vy] = lead.velocity;
  } else if (vx !== 0 || vy !== 0) {
    const spread = world.get(Spread)!;
    const keep = Math.exp(-delta * STONE_FRICTION);
    vx *= keep;
    vy *= keep;
    x += vx * delta;
    y += vy * delta;
    const left = BODY_ORIGIN.x + stone.horizon;
    const right = BODY_ORIGIN.x + spread.width - stone.horizon;
    const top = BODY_ORIGIN.y + stone.horizon;
    const bottom = BODY_ORIGIN.y + BODY_HEIGHT - stone.horizon;

    if ((x < left && vx < 0) || (x > right && vx > 0)) vx *= -STONE_BOUNCE;

    if ((y < top && vy < 0) || (y > bottom && vy > 0)) vy *= -STONE_BOUNCE;

    x = clamp(x, left, right);
    y = clamp(y, top, bottom);

    if (vx * vx + vy * vy < 1e-4) {
      vx = 0;
      vy = 0;
    }
  }

  const presence = stone.presence + ((stone.present ? 1 : 0) - stone.presence) * (1 - Math.exp(-delta * 3.2));
  world.set(Stone, {
    x,
    y,
    vx,
    vy,
    presence: presence < 0.002 ? 0 : presence,
    spin: stone.spin + delta * (0.9 + stone.heat * 2.4),
    heat: stone.heat * Math.exp(-delta * 1.4),
  });
}

/**
 * Pull letters out of the text. A letter whose ink comes within reach of the stone's clearance is taken: its
 * character leaves the text by an exact edit, so the paragraph closes the gap, and the letter becomes a rigid body
 * built from its own outline, starting where it was drawn and moving as it was moving. The stone takes a few a
 * frame at most and holds no more loose letters than the tier affords.
 */
export function captureLetters(world: World): void {
  const stone = world.get(Stone)!;
  const letters = world.get(Letterpress)!;
  const spread = world.get(Spread)!;

  if (!stone.present || stone.presence < 0.6 || stone.rewinding >= 0 || spread.mode !== 'detached') return;

  const physics = world.get(Physics)!;
  const script = world.get(Script)!;
  const taken = world.get(Taken)!;
  const budget = TIERS[world.get(Quality)!.tier].bodies;
  let appetite = Math.min(stone.appetite + world.get(Time)!.delta * CAPTURE_RATE, 4);
  const reach = stone.horizon * CLEARANCE + CAPTURE_REACH;
  const stoneX = stone.x - BODY_ORIGIN.x;
  const stoneY = stone.y - BODY_ORIGIN.y;
  const page = pageActions(world);
  const { spawnBody } = physicsActions(world);

  for (let index = 1; index < letters.count && appetite >= 1 && physics.bodies.size < budget; index++) {
    const state = letters.state[index]!;

    if (state !== REST && state !== SPRING) continue;

    const dx = letters.x[index]! + letters.pivotX[index]! - stoneX;
    const dy = letters.y[index]! + letters.pivotY[index]! - stoneY;
    const distance = Math.hypot(dx, dy);

    if (distance > reach) continue;

    const cluster = letters.cluster[index]!;
    const next = index + 1 < letters.count ? letters.cluster[index + 1]! : cluster + 1;

    // Only a letter that is one character and one glyph leaves cleanly: not a ligature, not a mark, not a point.
    if (
      !/\p{L}/u.test(script.original[cluster]!) ||
      letters.cluster[index - 1] === cluster ||
      next === cluster ||
      (next > cluster + 1 && /\p{L}/u.test(script.original[cluster + 1] ?? ' '))
    ) {
      continue;
    }

    const shape = letters.shape[index]!;
    let collider = colliders.get(shape);

    if (collider === undefined) {
      collider = buildCollider(letters.outlineAt(index), 0.02);
      colliders.set(shape, collider);
    }

    const size = letters.fontSize[index]!;
    // The body turns about its collider's centre, so the letter does too from here on.
    const pivotX = collider.centerX * size;
    const pivotY = -collider.centerY * size;
    const along = 1 / Math.max(distance, 1e-3);
    // It leaves as it was moving, with a nudge round the stone and a spin of its own.
    const spawned = spawnBody(index, collider, size, {
      x: letters.x[index]! + pivotX + BODY_ORIGIN.x,
      y: letters.y[index]! + pivotY + BODY_ORIGIN.y,
      angle: 0,
      vx: letters.vx[index]! - dy * along * 1.6 + stone.vx * 0.3,
      vy: letters.vy[index]! + dx * along * 1.6 + stone.vy * 0.3,
      spin: (jitter(index) - 0.5) * 9,
    });

    if (!spawned) continue;

    letters.pivotX[index] = pivotX;
    letters.pivotY[index] = pivotY;
    page.removeLetter(index);
    taken.order.push(index);
    appetite -= 1;
  }

  world.set(Stone, { appetite });
}

/**
 * Pull every loose letter toward the stone and carry its body's pose into its glyph. The pull falls with the
 * square of the distance and far out most of it runs round the stone, so a letter spirals in; at the horizon
 * none of it does, and the letter thins and is swallowed. The walls follow the column rules when those move.
 */
export function pullBodies(world: World): void {
  const physics = world.get(Physics);

  if (physics === undefined || physics.bodies.size === 0) return;

  const stone = world.get(Stone)!;
  const letters = world.get(Letterpress)!;
  const { delta } = world.get(Time)!;
  const page = pageActions(world);
  const { accelerateBody, removeBody } = physicsActions(world);

  if (stone.fenced !== world.get(Spread)!.geometry) stoneActions(world).fenceBodies();

  const horizon = Math.max(stone.horizon, 1e-3);
  const strength = PULL * stone.presence * horizon * horizon * Math.min(delta, 1 / 30);
  let heat = stone.heat;
  let swallowed = stone.swallowed;

  for (const [index, pose] of physics.poses) {
    if (letters.state[index] !== BODY) continue;

    const dx = stone.x - pose.x;
    const dy = stone.y - pose.y;
    const distance = Math.max(Math.hypot(dx, dy), 1e-3);
    const near = distance / horizon;

    if (stone.present && near < 0.8) {
      removeBody(index);
      page.swallowLetter(index);
      heat = Math.min(1, heat + 0.16);
      swallowed++;
      continue;
    }

    const pull = strength / (distance * distance + horizon * horizon * 0.3);
    const round = SWIRL * clamp((near - 1) / 2.2, 0, 1);
    const inward = Math.sqrt(1 - round * round);
    const ux = dx / distance;
    const uy = dy / distance;
    accelerateBody(index, (ux * inward - uy * round) * pull, (uy * inward + ux * round) * pull);
    letters.x[index] = pose.x - BODY_ORIGIN.x - letters.pivotX[index]!;
    letters.y[index] = pose.y - BODY_ORIGIN.y - letters.pivotY[index]!;
    letters.angle[index] = pose.angle;
    // A letter thins as it crosses the last horizon and a half.
    letters.scale[index] = stone.present ? clamp((near - 0.7) / 1.1, 0.05, 1) : 1;
  }

  world.set(Stone, { heat, swallowed });
}

/** The rewind is over once every letter it gave back has landed. */
export function finishRewind(world: World): void {
  const stone = world.get(Stone)!;

  if (stone.rewinding < 0) return;

  const done = stone.rewinding > 0.2 && world.get(Letterpress)!.moving === 0;
  world.set(Stone, { rewinding: done ? -1 : stone.rewinding + world.get(Time)!.delta });
}

/** Place the stone's drawing and tell the shaders and the post pass where it is, in the world and on screen. */
export function syncStoneView(world: World): void {
  const view = world.get(StoneView);

  if (view === undefined) return;

  const stone = world.get(Stone)!;
  const { group, camera, uniforms } = view;
  const x = pageToWorldX(stone.x);
  const y = pageToWorldY(stone.y);
  group.visible = stone.presence > 0;
  group.position.set(x, y, 0.02);
  group.scale.setScalar(stone.horizon / HORIZON_ON_PLANE);
  uniforms.uStone.value.set(x, y, stone.horizon * stone.presence);
  uniforms.uStonePresence.value = stone.presence;
  uniforms.uStoneSpin.value = stone.spin;
  uniforms.uStoneHeat.value = stone.heat;
  // The post pass bends the frame about the stone's place on screen, with the horizon as a share of its height.
  const elements = camera.matrixWorldInverse.elements;
  const depth = -(elements[2]! * x + elements[6]! * y + elements[14]!);
  const projection = camera.projectionMatrix.elements;
  const viewX = elements[0]! * x + elements[4]! * y + elements[12]!;
  const viewY = elements[1]! * x + elements[5]! * y + elements[13]!;
  const safe = Math.max(depth, 1e-3);
  uniforms.uStoneScreen.value.set((projection[0]! * viewX) / safe / 2, (-projection[5]! * viewY) / safe / 2);
  uniforms.uStoneLens.value = depth > 0 ? (projection[5]! * stone.horizon * stone.presence) / safe / 2 : 0;
}
