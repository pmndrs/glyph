/**
 * The juggling simulation. Pixel units, +Y up, origin at the centre of the view. Nothing here knows about React or
 * Three; the scene reads the world after each step and poses its objects from it.
 *
 * Queued letters sit where the paragraph layout placed them: the view calls `placeLetter` once a layout commits,
 * so kerning and word spacing belong to the text engine, not to this file.
 *
 * The juggler is superhuman by construction: the body chases the letter that will land soonest, a hand that is still
 * holding a letter tosses it the instant another one arrives, and a catch places the hand exactly under the letter
 * however far the arm has to stretch. A letter therefore never passes the hands.
 */

/** Downward acceleration in px/s². */
export const GRAVITY = 2200;
export const FONT_SIZE = 56;
/** Pause between one queued letter dropping and the next. */
export const RELEASE_INTERVAL = 0.45;
/** Upward kick a letter gets as it leaves the sentence, before gravity takes over. */
export const RELEASE_HOP = 340;
/** Spin given to a released letter, alternating direction by position in the sentence. */
export const RELEASE_SPIN = 2.4;
/** How long a hand keeps a letter before tossing it to the other hand. */
export const DWELL = 0.16;
/** Body speed in px/s. */
export const BODY_SPEED = 3600;
/** Speed at which a hand moves toward its target, in px/s. */
export const HAND_SPEED = 2600;
export const FLOOR_MARGIN = 36;
export const TOP_MARGIN = 72;
/** Horizontal distance from the body's centre line to each hand's outer catching position. */
export const HAND_OFFSET_X = 46;
/** Horizontal distance from the centre line to the inner throwing position. */
export const THROW_OFFSET_X = 14;
/** How far below the shoulders the hands rest. */
export const HAND_DROP = 34;
/** How far a hand dips while carrying a letter from the catch to the throw. */
export const SCOOP_DEPTH = 18;
/** How far from the shoulder a free hand reaches toward an incoming letter. */
export const REACH = 64;
/** Seconds with nothing in play before the juggler starts waving for input. */
export const WAVE_AFTER = 1.5;

export type Side = 'left' | 'right';
export type LetterState = 'queued' | 'airborne' | 'held';

export interface Letter {
  readonly id: number;
  /** UTF-16 offset of this character in the typed sentence. */
  readonly index: number;
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
  /** Seconds since the letter was typed. */
  age: number;
  /** Seconds since the letter left the sentence, or -1 while it still waits there. */
  released: number;
  /** Whether the view has placed the letter from a committed layout. */
  placed: boolean;
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
  /** Count of letters released so far; the view watches it for release effects. */
  releases: number;
  /** Time at which the last letter left play, for the idle wave. */
  idleSince: number;
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
  /** Top of the typed sentence. */
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
    releases: 0,
    idleSince: 0,
  };
}

export function resizeJugglerWorld(world: JugglerWorld, width: number, height: number): void {
  world.width = width;
  world.height = height;
}

/** Adds one typed character at sentence offset `index`. The sentence drops its letters one at a time in offset order. */
export function typeLetter(world: JugglerWorld, char: string, index: number): Letter {
  const queued = world.letters.filter((letter) => letter.state === 'queued');
  if (queued.length === 0) world.releaseTimer = RELEASE_INTERVAL;
  const letter: Letter = {
    id: world.nextId++,
    index,
    char,
    x: 0,
    y: figure(world.height).topY,
    vx: 0,
    vy: 0,
    rotation: 0,
    spin: 0,
    state: 'queued',
    target: 'left',
    catches: 0,
    age: 0,
    released: -1,
    placed: false,
  };
  world.letters.push(letter);
  return letter;
}

/** Moves a waiting letter to where the paragraph layout put it. Letters already in flight keep their own motion. */
export function placeLetter(world: JugglerWorld, index: number, x: number, y: number): void {
  const letter = world.letters.find((candidate) => candidate.index === index);
  if (letter === undefined || letter.state !== 'queued') return;
  letter.x = x;
  letter.y = y;
  letter.placed = true;
}

/** Removes the letter typed at sentence offset `index`, freeing a hand if it was holding it. */
export function removeLetter(world: JugglerWorld, index: number): Letter | undefined {
  const position = world.letters.findIndex((letter) => letter.index === index);
  if (position === -1) return undefined;
  const [letter] = world.letters.splice(position, 1);
  for (const hand of Object.values(world.juggler.hands)) {
    if (hand.holding === letter) hand.holding = undefined;
  }
  return letter;
}

export function stepJugglerWorld(world: JugglerWorld, dt: number): void {
  world.time += dt;
  const body = figure(world.height);
  const { juggler, letters } = world;

  for (const letter of letters) {
    letter.age += dt;
    if (letter.released >= 0) letter.released += dt;
  }

  // The sentence drops its earliest waiting letter on the release timer, with a hop and a spin.
  const next = earliestQueued(letters);
  if (next !== undefined) {
    world.releaseTimer -= dt;
    if (world.releaseTimer <= 0) {
      world.releaseTimer = RELEASE_INTERVAL;
      next.target = leastLoadedHand(letters);
      next.state = 'airborne';
      next.released = 0;
      next.vy = RELEASE_HOP;
      next.vx = 0;
      next.spin = (next.index % 2 === 0 ? 1 : -1) * RELEASE_SPIN;
      world.releases += 1;
    }
  }

  for (const letter of letters) {
    if (letter.state !== 'airborne') continue;
    letter.vy -= GRAVITY * dt;
    letter.x += letter.vx * dt;
    letter.y += letter.vy * dt;
    letter.rotation += letter.spin * dt;
  }

  // The body runs to stand under whichever letter lands first; each free hand reaches for its own next letter.
  let soonest: { readonly t: number; readonly x: number } | undefined;
  const incoming: Record<Side, { t: number; x: number } | undefined> = { left: undefined, right: undefined };
  for (const letter of letters) {
    if (letter.state !== 'airborne') continue;
    const t = timeToPlane(letter, body.catchY);
    const x = letter.x + letter.vx * t;
    if (soonest === undefined || t < soonest.t) soonest = { t, x: x - handOffsetX(letter.target) };
    const current = incoming[letter.target];
    if (current === undefined || t < current.t) incoming[letter.target] = { t, x };
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

  const inPlay = letters.some((letter) => letter.state !== 'queued');
  if (inPlay) world.idleSince = world.time;
  const waving = !inPlay && world.time - world.idleSince >= WAVE_AFTER;

  for (const hand of Object.values(juggler.hands)) {
    const sign = hand.side === 'left' ? -1 : 1;
    const held = hand.holding;
    let targetHandX: number;
    let targetHandY: number;
    if (held !== undefined) {
      // Carry the catch inward along a scoop and throw from beside the body.
      hand.heldFor += dt;
      const progress = clamp(hand.heldFor / DWELL, 0, 1);
      targetHandX = juggler.x + sign * THROW_OFFSET_X;
      targetHandY = body.catchY - SCOOP_DEPTH * Math.sin(Math.PI * progress);
    } else if (incoming[hand.side] !== undefined) {
      // Reach toward where the next letter for this hand will land, as far as the arm allows.
      const shoulderX = juggler.x + sign * 8;
      targetHandX = shoulderX + clamp(incoming[hand.side]!.x - shoulderX, -REACH, REACH);
      targetHandY = body.catchY;
    } else if (waving && hand.side === 'right') {
      const wave = world.time - world.idleSince - WAVE_AFTER;
      targetHandX = juggler.x + 34 + Math.sin(wave * 7) * 14;
      targetHandY = body.shoulderY + 44 + Math.cos(wave * 7) * 4;
    } else {
      targetHandX = juggler.x + handOffsetX(hand.side);
      targetHandY = body.catchY;
    }
    const step = HAND_SPEED * dt;
    hand.x += clamp(targetHandX - hand.x, -step, step);
    hand.y += clamp(targetHandY - hand.y, -step, step);
    if (held === undefined) continue;
    held.x = hand.x;
    held.y = hand.y;
    held.rotation *= Math.exp(-14 * dt);
    if (hand.heldFor >= DWELL) toss(world, hand);
  }
}

/** Throws the held letter in an arc that lands on the other hand's outer catching spot. */
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

function earliestQueued(letters: readonly Letter[]): Letter | undefined {
  let earliest: Letter | undefined;
  for (const letter of letters) {
    if (letter.state !== 'queued') continue;
    if (earliest === undefined || letter.index < earliest.index) earliest = letter;
  }
  return earliest;
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

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
