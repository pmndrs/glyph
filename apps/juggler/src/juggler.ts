/**
 * The juggling simulation. Pixel units, +Y up, origin at the centre of the view. Nothing here knows about React or
 * Three; the scene reads the world after each step and poses its objects from it.
 *
 * The juggler is superhuman by construction: the body chases the letter that will land soonest, a hand that is still
 * holding a letter tosses it the instant another one arrives, and a catch places the hand exactly under the letter
 * however far the arm has to stretch. A letter therefore never passes the hands.
 */

/** Downward acceleration in px/s². */
export const GRAVITY = 2200;
export const FONT_SIZE = 56;
/** Spacing of the typed row waiting at the top of the view. */
export const SLOT_SPACING = 46;
/** Pause between one queued letter dropping and the next. */
export const RELEASE_INTERVAL = 0.45;
/** How long a hand keeps a letter before tossing it to the other hand. */
export const DWELL = 0.16;
/** Body speed in px/s. */
export const BODY_SPEED = 3600;
/** Speed at which a hand returns to its resting position, in px/s. */
export const HAND_SPEED = 2600;
export const FLOOR_MARGIN = 36;
export const TOP_MARGIN = 56;
/** Horizontal distance from the body's centre line to each resting hand. */
export const HAND_OFFSET_X = 46;
/** How far below the shoulders the hands rest. */
export const HAND_DROP = 34;

export type Side = 'left' | 'right';
export type LetterState = 'queued' | 'airborne' | 'held';

export interface Letter {
  readonly id: number;
  readonly char: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
  state: LetterState;
  /** Hand expected to receive the letter while it is airborne. */
  target: Side;
  catches: number;
}

export interface Hand {
  readonly side: Side;
  x: number;
  y: number;
  holding: Letter | undefined;
  heldFor: number;
}

export interface Juggler {
  x: number;
  vx: number;
  /** Distance travelled, used to drive the running stride. */
  stride: number;
  readonly hands: Readonly<Record<Side, Hand>>;
}

export interface JugglerWorld {
  width: number;
  height: number;
  time: number;
  readonly letters: Letter[];
  readonly juggler: Juggler;
  releaseTimer: number;
  nextId: number;
}

/** Fixed body landmarks for the current view height. */
export interface Figure {
  readonly floorY: number;
  readonly hipY: number;
  readonly shoulderY: number;
  readonly headY: number;
  readonly headRadius: number;
  /** Height of the hands at rest, which is also the plane every letter is caught on. */
  readonly catchY: number;
  /** Where queued letters wait. */
  readonly topY: number;
}

export function figure(height: number): Figure {
  const floorY = -height / 2 + FLOOR_MARGIN;
  const shoulderY = floorY + 124;
  return {
    floorY,
    hipY: floorY + 66,
    shoulderY,
    headY: floorY + 150,
    headRadius: 15,
    catchY: shoulderY - HAND_DROP,
    topY: height / 2 - TOP_MARGIN,
  };
}

export function handOffsetX(side: Side): number {
  return side === 'left' ? -HAND_OFFSET_X : HAND_OFFSET_X;
}

export function opposite(side: Side): Side {
  return side === 'left' ? 'right' : 'left';
}

export function createJugglerWorld(width: number, height: number): JugglerWorld {
  const { catchY } = figure(height);
  const hand = (side: Side): Hand => ({ side, x: handOffsetX(side), y: catchY, holding: undefined, heldFor: 0 });
  return {
    width,
    height,
    time: 0,
    letters: [],
    juggler: { x: 0, vx: 0, stride: 0, hands: { left: hand('left'), right: hand('right') } },
    releaseTimer: 0,
    nextId: 1,
  };
}

export function resizeJugglerWorld(world: JugglerWorld, width: number, height: number): void {
  world.width = width;
  world.height = height;
}

/** Adds one letter to the row at the top. The row drops one letter at a time in typing order. */
export function typeLetter(world: JugglerWorld, char: string): Letter {
  const queued = world.letters.filter((letter) => letter.state === 'queued');
  if (queued.length === 0) world.releaseTimer = RELEASE_INTERVAL;
  const letter: Letter = {
    id: world.nextId++,
    char,
    x: slotX(queued.length, queued.length + 1),
    y: figure(world.height).topY,
    vx: 0,
    vy: 0,
    rotation: 0,
    spin: 0,
    state: 'queued',
    target: 'left',
    catches: 0,
  };
  world.letters.push(letter);
  return letter;
}

/** Removes the newest letter: the last queued one if the row is not empty, otherwise the last one in play. */
export function deleteLetter(world: JugglerWorld): Letter | undefined {
  const queued = world.letters.filter((letter) => letter.state === 'queued');
  const letter = queued.at(-1) ?? world.letters.at(-1);
  if (letter === undefined) return undefined;
  world.letters.splice(world.letters.indexOf(letter), 1);
  for (const hand of Object.values(world.juggler.hands)) {
    if (hand.holding === letter) hand.holding = undefined;
  }
  return letter;
}

export function stepJugglerWorld(world: JugglerWorld, dt: number): void {
  world.time += dt;
  const body = figure(world.height);
  const { juggler, letters } = world;

  // The typed row waits centred at the top; the next letter drops on the release timer.
  const queued = letters.filter((letter) => letter.state === 'queued');
  queued.forEach((letter, index) => {
    letter.x = slotX(index, queued.length);
    letter.y = body.topY;
  });
  const next = queued[0];
  if (next !== undefined) {
    world.releaseTimer -= dt;
    if (world.releaseTimer <= 0) {
      world.releaseTimer = RELEASE_INTERVAL;
      next.state = 'airborne';
      next.target = leastLoadedHand(letters);
    }
  }

  for (const letter of letters) {
    if (letter.state !== 'airborne') continue;
    letter.vy -= GRAVITY * dt;
    letter.x += letter.vx * dt;
    letter.y += letter.vy * dt;
    letter.rotation += letter.spin * dt;
  }

  // The body runs to stand under whichever letter lands first.
  let soonest: { readonly t: number; readonly x: number } | undefined;
  for (const letter of letters) {
    if (letter.state !== 'airborne') continue;
    const t = timeToPlane(letter, body.catchY);
    const x = letter.x + letter.vx * t - handOffsetX(letter.target);
    if (soonest === undefined || t < soonest.t) soonest = { t, x };
  }
  const targetX = soonest?.x ?? 0;
  const reach = BODY_SPEED * dt;
  const move = clamp(targetX - juggler.x, -reach, reach);
  juggler.x += move;
  juggler.vx = dt > 0 ? move / dt : 0;
  juggler.stride += Math.abs(move);

  for (const letter of letters) {
    if (letter.state !== 'airborne' || letter.vy > 0 || letter.y > body.catchY) continue;
    const hand = juggler.hands[letter.target];
    if (hand.holding !== undefined) toss(world, hand);
    letter.state = 'held';
    letter.y = body.catchY;
    letter.vx = 0;
    letter.vy = 0;
    letter.spin = 0;
    letter.catches += 1;
    hand.holding = letter;
    hand.heldFor = 0;
    hand.x = letter.x;
    hand.y = letter.y;
  }

  for (const hand of Object.values(juggler.hands)) {
    const restX = juggler.x + handOffsetX(hand.side);
    const step = HAND_SPEED * dt;
    hand.x += clamp(restX - hand.x, -step, step);
    hand.y += clamp(body.catchY - hand.y, -step, step);
    const held = hand.holding;
    if (held === undefined) continue;
    hand.heldFor += dt;
    held.x = hand.x;
    held.y = hand.y;
    held.rotation *= Math.exp(-14 * dt);
    if (hand.heldFor >= DWELL) toss(world, hand);
  }
}

/** Throws the held letter in an arc that lands on the other hand's resting spot. */
function toss(world: JugglerWorld, hand: Hand): void {
  const letter = hand.holding;
  if (letter === undefined) return;
  hand.holding = undefined;
  hand.heldFor = 0;
  const inPlay = world.letters.reduce((count, other) => count + (other.state === 'queued' ? 0 : 1), 0);
  const flight = flightTime(inPlay, world.height);
  const target = opposite(hand.side);
  const landingX = world.juggler.x + handOffsetX(target);
  letter.state = 'airborne';
  letter.target = target;
  letter.vx = (landingX - letter.x) / flight;
  letter.vy = (GRAVITY * flight) / 2;
  letter.spin = ((hand.side === 'left' ? -1 : 1) * (2 * Math.PI)) / flight;
}

/**
 * Flight time for a toss. Each hand must clear its dwell before the next letter arrives, so more letters in play
 * means higher throws, capped so the apex stays inside the view.
 */
export function flightTime(inPlay: number, height: number): number {
  const body = figure(height);
  const apex = body.topY - body.catchY - FONT_SIZE;
  const longest = Math.sqrt((8 * apex) / GRAVITY);
  const needed = 0.6 + DWELL * Math.max(0, inPlay / 2 - 1) * 1.6;
  return clamp(needed, Math.min(1, longest), longest);
}

/** Seconds until an airborne letter falls to `planeY`; zero when it is already at or below it. */
export function timeToPlane(letter: Letter, planeY: number): number {
  if (letter.y <= planeY) return 0;
  const discriminant = letter.vy * letter.vy + 2 * GRAVITY * (letter.y - planeY);
  return (letter.vy + Math.sqrt(discriminant)) / GRAVITY;
}

function leastLoadedHand(letters: readonly Letter[]): Side {
  let left = 0;
  let right = 0;
  for (const letter of letters) {
    if (letter.state === 'queued') continue;
    if (letter.target === 'left') left += 1;
    else right += 1;
  }
  return left <= right ? 'left' : 'right';
}

function slotX(index: number, count: number): number {
  return (index - (count - 1) / 2) * SLOT_SPACING;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
