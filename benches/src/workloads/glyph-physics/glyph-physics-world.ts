import type { b3BodyId, b3HullData, b3Quat, b3Vec3, b3WorldId, Box3DModule } from 'box3d.js';

import { emToWorld, type GlyphCollider } from './glyph-colliders';

/** World scale: one metre is this many CSS pixels, so a 24 px glyph is a 1.2 m body, well inside Box3D's tuned range. */
export const PIXELS_PER_METER = 20;
/** Fixed simulation step. The simulation never sees a variable `dt`, so a run is a pure function of its step count. */
export const STEP_SECONDS = 1 / 60;
/** Solver sub-steps per step: Box3D's recommended default. */
const SUB_STEPS = 4;
/** Gravity in metres per second squared. Stronger than Earth's: a screen-sized scene should land in about a second. */
const GRAVITY = 40;
/** Prism depth along z in em units. Every piece is extruded to this thickness, centred on the glyph's plane. */
export const COLLIDER_DEPTH_EM = 0.25;
/**
 * Farthest a body may move in one step, in em. Dynamic bodies are not swept against each other, so a body that travels
 * more than a thin stem's width (about 0.1 em) in one step can pass through its neighbours; a faster fall measured a 2.6 px
 * overlap in a settled pile. The speed cap is this distance over the step, scaled to the font size.
 */
const MAXIMUM_STEP_EM = 0.07;
/** Static bodies are this thick in metres, so nothing tunnels through the floor or a wall. */
const STATIC_THICKNESS = 2;
const FRICTION = 0.6;
const RESTITUTION = 0.12;
/** Seed of the single deterministic generator that varies each glyph's initial spin and drift. */
const LAUNCH_SEED = 0x6c7970;
/** Largest initial spin in radians per second, so neighbours topple differently without leaving the screen. */
const MAX_LAUNCH_SPIN = 2.5;
/** Largest initial horizontal drift in pixels per second. */
const MAX_LAUNCH_DRIFT = 40;

let box3dModule: Promise<Box3DModule> | undefined;

/** Loads and instantiates the Box3D WebAssembly module once, on first use, so only this workload pays for it. */
export function loadBox3d(): Promise<Box3DModule> {
  box3dModule ??= import('box3d.js').then(({ default: Box3D }) => Box3D());
  return box3dModule;
}

/** One glyph's launch state in the world frame: pen position, spin, and drift. All lengths are CSS pixels, y up. */
interface Launch {
  readonly drift: number;
  readonly penX: number;
  readonly penY: number;
  readonly spin: number;
}

/** A glyph's convex pieces as Box3D hulls at one font size, shared by every body of that glyph. */
interface HullSet {
  readonly hulls: readonly b3HullData[];
  readonly skippedPieces: number;
}

/** The pose of a body's origin, which is the glyph's pen position: pixels, y up, and a counter-clockwise angle. */
export interface BodyPose {
  angle: number;
  x: number;
  y: number;
}

/** The static floor and side walls, as bounds in the same frame as the bodies. */
export interface WorldBounds {
  readonly floorY: number;
  readonly left: number;
  readonly right: number;
}

/** mulberry32: a tiny seeded generator, so every run of the workload launches the same glyphs the same way. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** The rotation about z as a Box3D quaternion. */
function quaternionAboutZ(angle: number, target: b3Quat): b3Quat {
  target[0] = 0;
  target[1] = 0;
  target[2] = Math.sin(angle / 2);
  target[3] = Math.cos(angle / 2);
  return target;
}

/**
 * Glyph rigid bodies on a floor, in 2D: motion is locked to the xy plane, so each glyph is its collider pieces
 * extruded along z and free to translate in x and y and rotate about z. Hull data is copied into the world when a
 * shape is created, so the hull handles this class keeps are only a cache for stamping out repeated glyphs.
 */
export class GlyphPhysicsWorld {
  readonly #b3: Box3DModule;
  readonly #world: b3WorldId;
  readonly #bodies: b3BodyId[] = [];
  readonly #launches: Launch[] = [];
  readonly #hullSets = new Map<GlyphCollider, HullSet>();
  readonly #random = createRandom(LAUNCH_SEED);
  readonly #position: b3Vec3 = [0, 0, 0];
  readonly #rotation: b3Quat = [0, 0, 0, 1];
  readonly #velocity: b3Vec3 = [0, 0, 0];
  readonly #spin: b3Vec3 = [0, 0, 0];
  #boundaryBody: b3BodyId | undefined;
  #disposed = false;
  #skippedPieces = 0;
  #hullCount = 0;

  constructor(b3: Box3DModule, fontSize: number) {
    this.#b3 = b3;
    const definition = b3.b3DefaultWorldDef();
    definition.gravity = [0, -GRAVITY, 0];
    definition.maximumLinearSpeed = (MAXIMUM_STEP_EM * fontSize) / PIXELS_PER_METER / STEP_SECONDS;
    this.#world = b3.b3CreateWorld(definition);
  }

  get bodyCount(): number {
    return this.#bodies.length;
  }

  /** Pieces that Box3D could not turn into a hull and the world therefore does not collide with. */
  get skippedPieces(): number {
    return this.#skippedPieces;
  }

  /** Convex hull shapes the world holds on dynamic bodies, counting each body's own copy of a shared glyph's hulls. */
  get hullCount(): number {
    return this.#hullCount;
  }

  get awakeBodyCount(): number {
    return this.#b3.b3World_GetAwakeBodyCount(this.#world);
  }

  /** Replaces the floor and the two walls. The walls are as tall as the floor is thick, which no glyph can clear. */
  setBounds(bounds: WorldBounds, depth: number): void {
    const b3 = this.#b3;
    if (this.#boundaryBody !== undefined) b3.b3DestroyBody(this.#boundaryBody);
    const definition = b3.b3DefaultBodyDef();
    definition.type = b3.b3BodyType.b3_staticBody;
    const body = b3.b3CreateBody(this.#world, definition);
    const shape = b3.b3DefaultShapeDef();
    shape.baseMaterial.friction = FRICTION;
    shape.baseMaterial.restitution = RESTITUTION;
    const floorY = bounds.floorY / PIXELS_PER_METER;
    const left = bounds.left / PIXELS_PER_METER;
    const right = bounds.right / PIXELS_PER_METER;
    const halfSpan = (right - left) / 2 + STATIC_THICKNESS;
    const centerX = (left + right) / 2;
    const height = 1_000 / PIXELS_PER_METER;
    const halfDepth = depth / PIXELS_PER_METER;
    const placeBox = (x: number, y: number, halfX: number, halfY: number): void => {
      const hull = b3.b3CreateHull(boxCorners(x, y, halfX, halfY, halfDepth));
      if (hull === null) throw new Error('the world boundary produced a degenerate hull');
      b3.b3CreateHullShape(body, shape, hull);
      hull.delete();
    };
    placeBox(centerX, floorY - STATIC_THICKNESS / 2, halfSpan, STATIC_THICKNESS / 2);
    placeBox(left - STATIC_THICKNESS / 2, floorY + height / 2, STATIC_THICKNESS / 2, height / 2);
    placeBox(right + STATIC_THICKNESS / 2, floorY + height / 2, STATIC_THICKNESS / 2, height / 2);
    this.#boundaryBody = body;
  }

  /**
   * Adds one dynamic body at a glyph's pen position. Every convex piece of `collider` becomes a hull shape on the
   * body, with its vertices expressed relative to the pen position, so the body origin is the pen position and the
   * pose written back to the renderer needs no per-glyph offset.
   */
  addGlyph(collider: GlyphCollider, fontSize: number, penX: number, penY: number): number {
    const b3 = this.#b3;
    const { hulls } = this.#hullsFor(collider, fontSize);
    const definition = b3.b3DefaultBodyDef();
    definition.type = b3.b3BodyType.b3_dynamicBody;
    definition.position = [penX / PIXELS_PER_METER, penY / PIXELS_PER_METER, 0];
    definition.motionLocks = {
      angularX: true,
      angularY: true,
      angularZ: false,
      linearX: false,
      linearY: false,
      linearZ: true,
    };
    const body = b3.b3CreateBody(this.#world, definition);
    const shape = b3.b3DefaultShapeDef();
    shape.baseMaterial.friction = FRICTION;
    shape.baseMaterial.restitution = RESTITUTION;
    for (const hull of hulls) b3.b3CreateHullShape(body, shape, hull);
    this.#hullCount += hulls.length;
    const launch: Launch = {
      drift: (this.#random() * 2 - 1) * MAX_LAUNCH_DRIFT,
      penX,
      penY,
      spin: (this.#random() * 2 - 1) * MAX_LAUNCH_SPIN,
    };
    this.#bodies.push(body);
    this.#launches.push(launch);
    this.#launch(this.#bodies.length - 1);
    return this.#bodies.length - 1;
  }

  /** Advances the world by one fixed step. */
  step(): void {
    this.#b3.b3World_Step(this.#world, STEP_SECONDS, SUB_STEPS);
  }

  /** Puts every glyph back at its pen position and gives it its launch spin and drift again. */
  restart(): void {
    for (let index = 0; index < this.#bodies.length; index += 1) this.#launch(index);
  }

  /** Wakes every body, so a changed floor or wall takes effect on glyphs that had gone to sleep. */
  wake(): void {
    for (const body of this.#bodies) this.#b3.b3Body_SetAwake(body, true);
  }

  /** Reads one body's pose in CSS pixels. */
  pose(index: number, target: BodyPose): BodyPose {
    this.#b3.b3Body_GetTransform(this.#position, this.#rotation, this.#bodies[index]!);
    target.x = this.#position[0] * PIXELS_PER_METER;
    target.y = this.#position[1] * PIXELS_PER_METER;
    target.angle = 2 * Math.atan2(this.#rotation[2], this.#rotation[3]);
    return target;
  }

  /** The Box3D world, for queries; the caller must not destroy it. */
  get world(): b3WorldId {
    return this.#world;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const { hulls } of this.#hullSets.values()) for (const hull of hulls) hull.delete();
    this.#hullSets.clear();
    // Destroying the world frees every body and shape in it.
    this.#b3.b3DestroyWorld(this.#world);
  }

  #launch(index: number): void {
    const b3 = this.#b3;
    const body = this.#bodies[index]!;
    const { drift, penX, penY, spin } = this.#launches[index]!;
    this.#position[0] = penX / PIXELS_PER_METER;
    this.#position[1] = penY / PIXELS_PER_METER;
    this.#position[2] = 0;
    b3.b3Body_SetTransform(body, this.#position, quaternionAboutZ(0, this.#rotation));
    this.#velocity[0] = drift / PIXELS_PER_METER;
    this.#velocity[1] = 0;
    this.#velocity[2] = 0;
    b3.b3Body_SetLinearVelocity(body, this.#velocity);
    this.#spin[0] = 0;
    this.#spin[1] = 0;
    this.#spin[2] = spin;
    b3.b3Body_SetAngularVelocity(body, this.#spin);
    b3.b3Body_SetAwake(body, true);
  }

  #hullsFor(collider: GlyphCollider, fontSize: number): HullSet {
    const cached = this.#hullSets.get(collider);
    if (cached !== undefined) return cached;
    const point = { x: 0, y: 0 };
    const halfDepth = (COLLIDER_DEPTH_EM * fontSize) / 2 / PIXELS_PER_METER;
    const hulls: b3HullData[] = [];
    let skipped = 0;
    for (const piece of collider.pieces) {
      const positions: number[] = [];
      for (let index = 0; index < piece.length; index += 2) {
        emToWorld(piece[index]!, piece[index + 1]!, fontSize, point);
        const x = point.x / PIXELS_PER_METER;
        const y = point.y / PIXELS_PER_METER;
        positions.push(x, y, -halfDepth, x, y, halfDepth);
      }
      const hull = this.#b3.b3CreateHull(positions);
      if (hull === null) skipped += 1;
      else hulls.push(hull);
    }
    this.#skippedPieces += skipped;
    const created = { hulls, skippedPieces: skipped };
    this.#hullSets.set(collider, created);
    return created;
  }
}

/** The eight corners of an axis-aligned box centred at `x, y, 0`, as a flat position list. */
function boxCorners(x: number, y: number, halfX: number, halfY: number, halfZ: number): number[] {
  const corners: number[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) corners.push(x + sx * halfX, y + sy * halfY, sz * halfZ);
    }
  }
  return corners;
}
