import type { Glyphs } from '@pmndrs/glyph/three';
import { Matrix4, Quaternion, Vector3 } from 'three/webgpu';

import { POSE_STRIDE } from '../physics/stream';
import { type LetterSpec, TitleWorld } from '../physics/title-world';
import type { Box3DModule } from '../physics/world';
import { departureAt, flight } from './departure';
import type { Footprint } from './floor';
import { setTitleReach } from './metrics';
import type { HoleState } from './hole';
import type { Solid } from './outline';

/** The lift: each letter is carried up to this short of the camera and thrown back down, 35 ms after its
 * neighbour. Where it lands is the floor's business. */
const LIFT_CLEARANCE = 1.6;
const LIFT_SECONDS = 0.45;
const STAGGER = 0.035;
/** Thrown down, not dropped: the fall should read as a smash, not a float. */
const THROW = 35;
/** A little sideways and a little spin on the way down, so each letter settles off its mark and off square. */
const DRIFT = 0.9;
const SPIN = 0.35;
/** Successive replays throw each letter a different way, so the word never settles the same twice. */
const REPLAY_TURN = 2.4;
/** Half a letter's diagonal: how far a corner can reach above a tilted letter's centre. */
const HALF_DIAGONAL = 3.2;
/** The heavy title follows a wider, slower arc than the small glyphs. */
const FLIGHT_SECONDS = 0.85;

/** One letter of the title: its rest place in world units, its solid for the physics, and its glyph. */
export interface Letter {
  readonly home: readonly [x: number, y: number, z: number];
  readonly solid: Solid;
  /** The letter's glyph in the broken-apart copy of the paragraph, and its rest matrix there. */
  readonly index: number;
  readonly original: Matrix4;
}

/** A letter's place on the floor, in world units. */
export interface Landing {
  readonly index: number;
  readonly x: number;
  readonly y: number;
}

/** One replay's lift: where each letter was picked up from, and which have already been let go. */
interface Lift {
  elapsed: number;
  readonly from: readonly { readonly x: number; readonly y: number; readonly yaw: number }[];
  readonly released: boolean[];
}

/** body⁻¹ · glyphsWorld · original: the glyph's rigid offset from its body at rest. */
interface Piece {
  readonly letter: Letter;
  readonly offset: Matrix4;
}

const position = new Vector3();
const rotation = new Quaternion();

const scale = new Vector3(1, 1, 1);
const body = new Matrix4();
const glyphMatrix = new Matrix4();

function easeInOutSine(t: number): number {
  return 0.5 - Math.cos(Math.PI * t) / 2;
}

/**
 * The title's letters as slabs on the floor, drawn by glyph. The paragraph is broken apart once, and each glyph
 * copy then follows its rigid body through `Glyphs.setMatrixAt`, so a lift towards the camera is real depth and a
 * shove is a real move, with the paragraph's own shaping and materials untouched. A replay carries every letter up
 * to just short of the camera, back over its place in the word, and throws it down; the floor decides the bounce
 * and where it comes to rest. The robot drives through them and they stay where they were pushed.
 */
export class TitleBodies {
  readonly #pieces: readonly Piece[];
  readonly #glyphs: Glyphs;
  readonly #glyphsWorldInverse: Matrix4;
  readonly #world: TitleWorld;
  readonly #liftHeight: number;
  #lift: Lift | undefined;
  #replays = 0;
  /** Letters the hole has taken; they come back with the next replay. */
  readonly #swallowed = new Set<number>();
  /** Capture the actual robot-shoved poses once, then carry each letter along its accelerating arc. */
  #departureOrigins: { x: number; y: number; z: number; yaw: number }[] | undefined;
  /** How much each letter's quad is grown for the bend, applied with its body pose. */
  readonly #grow: number[];

  /**
   * `glyphs` is the broken-apart paragraph, already in the scene with its world matrix current; each letter's
   * `original` is its rest matrix there. `thickness` is how deep the invisible solids reach.
   */
  constructor(b3: Box3DModule, glyphs: Glyphs, letters: readonly Letter[], cameraHeight: number, thickness: number) {
    this.#glyphs = glyphs;
    this.#glyphsWorldInverse = glyphs.matrixWorld.clone().invert();
    this.#liftHeight = cameraHeight - LIFT_CLEARANCE;
    this.#pieces = letters.map((letter) => {
      body.makeTranslation(letter.home[0], letter.home[1], letter.home[2]);
      return { letter, offset: body.clone().invert().multiply(glyphs.matrixWorld).multiply(letter.original) };
    });
    this.#grow = letters.map(() => 1);
    const specs: LetterSpec[] = letters.map(({ home, solid }) => ({
      position: [home[0], home[1], home[2]],
      prisms: solid.prisms,
    }));
    const floorTop = Math.min(...letters.map(({ home }) => home[2])) - thickness / 2;
    this.#world = new TitleWorld(b3, specs, floorTop);
    for (let index = 0; index < letters.length; index += 1) this.#write(index);
  }

  /** Starts a lift and smash from wherever the letters are now; letters the hole took start from home. */
  replay(): void {
    this.#replays += 1;
    for (const index of this.#swallowed) {
      const letter = this.#pieces[index]?.letter;
      if (letter !== undefined)
        this.#world.revive(index, { x: letter.home[0], y: letter.home[1], z: letter.home[2], yaw: 0 });
      this.#grow[index] = 1;
      this.#write(index);
    }
    this.#swallowed.clear();
    this.#departureOrigins = undefined;
    this.#lift = {
      elapsed: 0,
      from: this.#pieces.map((_, index) => this.#poseOf(index)),
      released: this.#pieces.map(() => false),
    };
  }

  /** Advances by `delta` seconds with the robot where it is, and reports the letters that hit the floor. */
  update(delta: number, robot: Footprint | undefined, hole: HoleState): readonly Landing[] {
    this.#carry(delta);
    this.#attract(hole);
    const { moved, landed } = this.#world.step(delta, robot);
    setTitleReach(this.reach);
    for (const index of moved) this.#write(index);
    return landed.map((index) => {
      const offset = index * POSE_STRIDE;
      return { index, x: this.#world.poses[offset] ?? 0, y: this.#world.poses[offset + 1] ?? 0 };
    });
  }

  dispose(): void {
    this.#world.destroy();
  }

  /** The highest point of any letter, in world units: its centre's height plus what its tilt lifts a corner. */
  get reach(): number {
    const poses = this.#world.poses;
    let reach = 0;
    for (let index = 0; index < this.#pieces.length; index += 1) {
      const offset = index * POSE_STRIDE;
      const qx = poses[offset + 3] ?? 0;
      const qy = poses[offset + 4] ?? 0;
      // The rotated z axis's z component; its sine against world z is how far the letter's plane tips.
      const upright = 1 - 2 * (qx * qx + qy * qy);
      const tilt = Math.sqrt(Math.max(0, 1 - upright * upright));
      reach = Math.max(reach, (poses[offset + 2] ?? 0) + tilt * HALF_DIAGONAL);
    }
    return reach;
  }

  /** Every letter's body pose in world units, for inspecting a smash from DevTools. */
  get poses(): readonly { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }[] {
    return this.#pieces.map((_, index) => {
      const offset = index * POSE_STRIDE;
      return { ...this.#poseOf(index), z: this.#world.poses[offset + 2] ?? 0 };
    });
  }

  /** Moves the lift on: carries each letter up over its place, then lets it go with its throw. */
  #carry(delta: number): void {
    const lift = this.#lift;
    if (lift === undefined) return;
    lift.elapsed += delta;
    let pending = false;
    for (const [index, { letter }] of this.#pieces.entries()) {
      if (lift.released[index]) continue;
      const time = lift.elapsed - index * STAGGER;
      if (time < 0) {
        pending = true;
        continue;
      }
      const from = lift.from[index];
      if (from === undefined) continue;
      const [homeX, homeY, homeZ] = letter.home;
      if (time < LIFT_SECONDS) {
        const rise = easeInOutSine(time / LIFT_SECONDS);
        this.#world.hold(index, {
          x: from.x + (homeX - from.x) * rise,
          y: from.y + (homeY - from.y) * rise,
          z: homeZ + this.#liftHeight * rise,
          yaw: from.yaw * (1 - rise),
        });
        pending = true;
        continue;
      }
      this.#world.hold(index, { x: homeX, y: homeY, z: homeZ + this.#liftHeight, yaw: 0 });
      const way = (index + this.#replays) * REPLAY_TURN;
      this.#world.release(index, {
        velocity: [Math.cos(way) * DRIFT, Math.sin(way) * DRIFT, -THROW],
        spin: (index + this.#replays) % 2 === 0 ? SPIN : -SPIN,
      });
      lift.released[index] = true;
    }
    if (!pending) this.#lift = undefined;
  }

  /** Pulls every letter still on the floor towards the hole, round it, and takes those that reach the horizon. */
  #attract(hole: HoleState): void {
    if (hole.beat === 'closed') {
      if (this.#grow.some((grow) => grow !== 1)) {
        this.#grow.fill(1);
        for (let index = 0; index < this.#pieces.length; index += 1) this.#write(index);
      }
      return;
    }
    this.#departureOrigins ??= this.#pieces.map((_, index) => this.#poseOf(index));
    for (const [index, from] of this.#departureOrigins.entries()) {
      if (this.#swallowed.has(index)) continue;
      const departure = departureAt(Math.hypot(from.x - hole.x, from.y - hole.y) / 9, index);
      const pose = flight(hole.time, departure, FLIGHT_SECONDS);
      if (pose.size === 0 || hole.beat === 'black') {
        this.#swallowed.add(index);
        this.#world.swallow(index);
        this.#grow[index] = 0;
        this.#write(index);
        continue;
      }
      const x = from.x - hole.x;
      const y = from.y - hole.y;
      const cosine = Math.cos(pose.turn);
      const sine = Math.sin(pose.turn);
      this.#world.hold(index, {
        x: hole.x + (x * cosine - y * sine) * pose.radius,
        y: hole.y + (x * sine + y * cosine) * pose.radius,
        z: from.z + Math.sin(Math.PI * (1 - pose.size)) * 1.8,
        yaw: from.yaw + pose.turn,
      });
      this.#grow[index] = pose.size * (1 + 0.35 * Math.sin(Math.PI * (1 - pose.size)));
    }
  }

  #poseOf(index: number): { x: number; y: number; z: number; yaw: number } {
    const poses = this.#world.poses;
    const offset = index * POSE_STRIDE;
    return {
      x: poses[offset] ?? 0,
      y: poses[offset + 1] ?? 0,
      z: poses[offset + 2] ?? 0,
      yaw: 2 * Math.atan2(poses[offset + 5] ?? 0, poses[offset + 6] ?? 1),
    };
  }

  /** Moves letter `index`'s glyph to its body: `glyphsWorld⁻¹ · body · offset`. */
  #write(index: number): void {
    const piece = this.#pieces[index];
    if (piece === undefined) return;
    const poses = this.#world.poses;
    const offset = index * POSE_STRIDE;
    position.set(poses[offset] ?? 0, poses[offset + 1] ?? 0, poses[offset + 2] ?? 0);
    rotation.set(poses[offset + 3] ?? 0, poses[offset + 4] ?? 0, poses[offset + 5] ?? 0, poses[offset + 6] ?? 1);
    // Grown about its centre for the hole's bend; a swallowed letter is grown to nothing.
    const grow = this.#grow[index] ?? 1;
    scale.set(grow, grow, 1);
    body.compose(position, rotation, scale);
    glyphMatrix.multiplyMatrices(this.#glyphsWorldInverse, body).multiply(piece.offset);
    this.#glyphs.setMatrixAt(piece.letter.index, glyphMatrix);
  }
}
