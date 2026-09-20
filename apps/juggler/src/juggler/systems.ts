import type { Entity, World } from 'koota';
import { clamp } from 'math';
import { Time } from '../time/traits';
import { letterActions } from '../letters/actions';
import { Letter } from '../letters/traits';
import { jugglerActions } from './actions';
import { FigureView, Hand, Juggler, Viewport } from './traits';
import { DWELL, bend, figure, handOffsetX, opposite, timeToPlane, type Side } from './utils';

/**
 * The body runs to stand under whichever letter lands first, leaning toward the other hand's next catch as far as
 * the first hand's reach allows; each hand notes the next letter headed its way.
 */
export function chaseLandings(world: World): void {
  const { delta } = world.get(Time)!;
  const { catchY } = figure(world.get(Viewport)!.height);
  const juggler = world.get(Juggler)!;
  let soonest: Side | undefined;
  const incoming: Record<Side, { t: number; x: number }> = {
    left: { t: Number.POSITIVE_INFINITY, x: 0 },
    right: { t: Number.POSITIVE_INFINITY, x: 0 },
  };

  for (const entity of world.query(Letter)) {
    const letter = entity.get(Letter)!;

    if (letter.state !== 'airborne') continue;

    const t = timeToPlane(letter.y, letter.vy, catchY);
    const x = letter.x + letter.vx * t;

    if (t < incoming[letter.target].t) incoming[letter.target] = { t, x };

    if (soonest === undefined || t < incoming[soonest].t) soonest = letter.target;
  }

  let targetX = 0;

  if (soonest !== undefined) {
    targetX = incoming[soonest].x - handOffsetX(soonest);
    const other = opposite(soonest);

    if (Number.isFinite(incoming[other].t)) {
      const slack = juggler.reach * 0.6;
      targetX += clamp(incoming[other].x - handOffsetX(other) - targetX, -slack, slack);
    }
  }

  const reach = juggler.speed * delta;
  const move = clamp(targetX - juggler.x, -reach, reach);
  juggler.x += move;
  juggler.vx = delta > 0 ? move / delta : 0;
  juggler.stride += Math.abs(move);
  world.set(Juggler, juggler);

  world.query(Hand).updateEach(([hand]) => {
    const next = incoming[hand.side];
    hand.incoming = Number.isFinite(next.t);
    hand.incomingX = next.x;
  });
}

/**
 * A falling letter reaching the catch plane is caught only if its hand is free and within grip of it; otherwise
 * it is dropped and dies.
 */
export function catchLetters(world: World): void {
  const { catchY } = figure(world.get(Viewport)!.height);
  const juggler = world.get(Juggler)!;
  const hands: Partial<Record<Side, Entity>> = {};

  for (const entity of world.query(Hand)) hands[entity.get(Hand)!.side] = entity;

  for (const entity of world.query(Letter)) {
    const letter = entity.get(Letter)!;

    if (letter.state !== 'airborne' || letter.vy > 0 || letter.y > catchY) continue;

    const handEntity = hands[letter.target];
    let hand = handEntity?.get(Hand);

    // A hand that has handled its letter for at least half the dwell can throw early to make the catch.
    if (handEntity !== undefined && hand?.holding !== undefined && hand.heldFor >= DWELL / 2) {
      jugglerActions(world).tossLetter(handEntity);
      hand = handEntity.get(Hand);
    }

    if (
      handEntity !== undefined &&
      hand !== undefined &&
      hand.holding === undefined &&
      Math.abs(hand.x - letter.x) <= juggler.grip
    ) {
      jugglerActions(world).holdLetter(handEntity, entity);
    } else {
      letterActions(world).dropLetter(entity);
      juggler.dropped += 1;
    }
  }

  world.set(Juggler, juggler);
}

/**
 * Hands carry a catch inward along a scoop and throw from beside the body, reach toward the next letter headed
 * their way, and wave for input when there is nothing to juggle.
 */
export function moveHands(world: World): void {
  const { delta, elapsed } = world.get(Time)!;
  const body = figure(world.get(Viewport)!.height);
  const juggler = world.get(Juggler)!;
  let inPlay = false;

  for (const entity of world.query(Letter)) {
    const state = entity.get(Letter)!.state;

    if (state === 'airborne' || state === 'held') inPlay = true;
  }

  if (inPlay) {
    juggler.idleSince = elapsed;
    world.set(Juggler, juggler);
  }

  const wave = elapsed - juggler.idleSince - 1.5;
  const tossing: Entity[] = [];

  world.query(Hand).updateEach(([hand], entity) => {
    const sign = hand.side === 'left' ? -1 : 1;
    const held = hand.holding;
    let targetX: number;
    let targetY: number;

    if (held !== undefined) {
      hand.heldFor += delta;
      const progress = clamp(hand.heldFor / DWELL, 0, 1);
      targetX = juggler.x + sign * 24;
      targetY = body.catchY - 18 * Math.sin(Math.PI * progress);
    } else if (hand.incoming) {
      const shoulderX = juggler.x + sign * 8;
      targetX = shoulderX + clamp(hand.incomingX - shoulderX, -juggler.reach, juggler.reach);
      targetY = body.catchY;
    } else if (wave >= 0 && hand.side === 'right') {
      targetX = juggler.x + 34 + Math.sin(wave * 7) * 14;
      targetY = body.shoulderY + 44 + Math.cos(wave * 7) * 4;
    } else {
      targetX = juggler.x + handOffsetX(hand.side);
      targetY = body.catchY;
    }

    const step = juggler.handSpeed * delta;
    hand.x += clamp(targetX - hand.x, -step, step);
    hand.y += clamp(targetY - hand.y, -step, step);

    if (held === undefined) return;

    const letter = held.get(Letter)!;
    letter.x = hand.x;
    letter.y = hand.y;
    letter.rotation *= Math.exp(-14 * delta);
    held.set(Letter, letter);

    if (hand.heldFor >= DWELL) tossing.push(entity);
  });

  for (const entity of tossing) jugglerActions(world).tossLetter(entity);
}

/** A stick figure posed from the body and hands: two-bone arms reach the hands, legs stride with the body. */
export function syncFigureView(world: World): void {
  const view = world.get(FigureView);

  if (view === undefined) return;

  const { delta } = world.get(Time)!;
  const juggler = world.get(Juggler)!;
  const body = figure(world.get(Viewport)!.height);
  const part = (name: string) => view.parts.get(name);
  view.eased += (juggler.vx - view.eased) * (1 - Math.exp(-10 * delta));
  const velocity = view.eased;
  const lean = clamp(velocity * 0.014, -18, 18);
  const running = clamp(Math.abs(velocity) / 700, 0, 1);
  const forward = Math.abs(velocity) > 40 ? Math.sign(velocity) : 0;
  const hipX = juggler.x;
  const shoulderX = hipX + lean;
  poseLimb(part('torso'), hipX, body.hipY, shoulderX, body.shoulderY);
  part('head')?.position.set(shoulderX + lean * 0.4, body.headY, 0);

  for (const entity of world.query(Hand)) {
    const hand = entity.get(Hand)!;
    const side = hand.side;
    const sign = side === 'left' ? -1 : 1;
    const sx = shoulderX + sign * 8;
    // Elbows hang below a low hand and point outward under a raised one.
    const elbow =
      hand.y > body.shoulderY
        ? bend(view.joint, sx, body.shoulderY, hand.x, hand.y, 36, sign, 0.2)
        : bend(view.joint, sx, body.shoulderY, hand.x, hand.y, 36, sign * 0.4, -1);
    poseLimb(part(`${side}UpperArm`), sx, body.shoulderY, elbow[0], elbow[1]);
    poseLimb(part(`${side}Forearm`), elbow[0], elbow[1], hand.x, hand.y);
    part(`${side}Elbow`)?.position.set(elbow[0], elbow[1], 0);
    part(`${side}Hand`)?.position.set(hand.x, hand.y, 0);

    const phase = juggler.stride / 28 + (side === 'left' ? 0 : Math.PI);
    const footX = hipX + sign * 14 + Math.sin(phase) * 22 * running * (forward || 1);
    const footY = body.floorY + Math.max(0, Math.cos(phase)) * 16 * running;
    const knee = bend(view.joint, hipX, body.hipY, footX, footY, 34, forward || sign, 0.2);
    poseLimb(part(`${side}Thigh`), hipX, body.hipY, knee[0], knee[1]);
    poseLimb(part(`${side}Shin`), knee[0], knee[1], footX, footY);
    part(`${side}Knee`)?.position.set(knee[0], knee[1], 0);
  }
}

/** Stretches a unit-length plane between two points. */
function poseLimb(
  mesh:
    | { position: { set(x: number, y: number, z: number): unknown }; rotation: { z: number }; scale: { x: number } }
    | undefined,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): void {
  if (mesh === undefined) return;

  const dx = bx - ax;
  const dy = by - ay;
  mesh.position.set((ax + bx) / 2, (ay + by) / 2, 0);
  mesh.rotation.z = Math.atan2(dy, dx);
  mesh.scale.x = Math.max(Math.hypot(dx, dy), 0.001);
}
