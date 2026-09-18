import type Box3D from 'box3d.js/inline';

import { POSE_STRIDE } from './stream';

export type Box3DModule = Awaited<ReturnType<typeof Box3D>>;
type Vec3 = [x: number, y: number, z: number];
type Quat = [x: number, y: number, z: number, w: number];

export interface GlyphBodySpec {
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly halfExtents: Vec3;
  /** Contact with this body starts the slow-motion impact (title and headline glyphs). */
  readonly impactTarget: boolean;
}

export interface BallSpec {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly radius: number;
}

export interface StepResult {
  /** Body indices whose pose changed this step (the ball is index `glyphCount`). */
  readonly moved: readonly number[];
  /** True on the step where the ball first touched an impact target. */
  readonly impact: boolean;
}

const GLYPH_RESTITUTION = 0.35;
const BALL_RESTITUTION = 0.45;
const FRONT_RESTITUTION = 0.6;
const BALL_DENSITY = 12;

/** One break's rigid-body world: sleeping glyph boxes, a bullet ball, and a static pane in front of the camera. */
export class BreakWorld {
  readonly glyphCount: number;
  readonly bodyCount: number;
  /** Raw physics poses, `bodyCount × POSE_STRIDE` (px, py, pz, qx, qy, qz, qw). */
  readonly poses: Float32Array;
  readonly #b3: Box3DModule;
  readonly #world: ReturnType<Box3DModule['b3CreateWorld']>;
  readonly #events: ReturnType<Box3DModule['createEventsBuffer']>;
  readonly #move: ReturnType<Box3DModule['createBodyMoveEvent']>;
  readonly #touch: ReturnType<Box3DModule['createContactTouchEvent']>;
  readonly #bodyIndex = new Map<number, number>();
  readonly #targetShapes = new Set<number>();
  #ballShape = -1;
  #impacted = false;

  constructor(b3: Box3DModule, glyphs: readonly GlyphBodySpec[], ball: BallSpec, frontPlaneZ: number) {
    this.#b3 = b3;
    this.glyphCount = glyphs.length;
    this.bodyCount = glyphs.length + 1;
    this.poses = new Float32Array(this.bodyCount * POSE_STRIDE);

    const worldDef = b3.b3DefaultWorldDef();
    // Low: the impact should throw the glyphs, not gravity rain them down the frame.
    worldDef.gravity = [0, -0.8, 0];
    this.#world = b3.b3CreateWorld(worldDef);
    this.#events = b3.createEventsBuffer();
    this.#move = b3.createBodyMoveEvent();
    this.#touch = b3.createContactTouchEvent();

    for (const [index, glyph] of glyphs.entries()) {
      const bodyDef = b3.b3DefaultBodyDef();
      bodyDef.type = b3.b3BodyType.b3_dynamicBody;
      bodyDef.position = glyph.position;
      bodyDef.rotation = glyph.rotation;
      // Awake from the start: a bullet's sweep can skip sleeping bodies, and at this gravity nothing visibly drifts
      // in the fraction of a second before the ball arrives.
      bodyDef.isAwake = true;
      bodyDef.linearDamping = 0.05;
      bodyDef.angularDamping = 0.1;
      const body = b3.b3CreateBody(this.#world, bodyDef);
      const shapeDef = b3.b3DefaultShapeDef();
      shapeDef.enableContactEvents = true;
      shapeDef.baseMaterial.restitution = GLYPH_RESTITUTION;
      const [hx, hy, hz] = glyph.halfExtents;
      const shape = b3.b3CreateBoxShape(body, shapeDef, hx, hy, hz);
      if (glyph.impactTarget) this.#targetShapes.add(shape.index1);
      this.#bodyIndex.set(body.index1, index);
      this.#writePose(index, glyph.position, glyph.rotation);
    }

    const ballDef = b3.b3DefaultBodyDef();
    ballDef.type = b3.b3BodyType.b3_dynamicBody;
    ballDef.position = ball.position;
    ballDef.linearVelocity = ball.velocity;
    ballDef.isBullet = true;
    ballDef.gravityScale = 0;
    const ballBody = b3.b3CreateBody(this.#world, ballDef);
    const ballShapeDef = b3.b3DefaultShapeDef();
    ballShapeDef.enableContactEvents = true;
    ballShapeDef.density = BALL_DENSITY;
    ballShapeDef.baseMaterial.restitution = BALL_RESTITUTION;
    this.#ballShape = b3.b3CreateSphereShape(ballBody, ballShapeDef, {
      center: [0, 0, 0],
      radius: ball.radius,
    }).index1;
    this.#bodyIndex.set(ballBody.index1, this.glyphCount);
    this.#writePose(this.glyphCount, ball.position, [0, 0, 0, 1]);

    const paneDef = b3.b3DefaultBodyDef();
    paneDef.type = b3.b3BodyType.b3_staticBody;
    paneDef.position = [0, 0, frontPlaneZ];
    const pane = b3.b3CreateBody(this.#world, paneDef);
    const paneShapeDef = b3.b3DefaultShapeDef();
    paneShapeDef.baseMaterial.restitution = FRONT_RESTITUTION;
    b3.b3CreateBoxShape(pane, paneShapeDef, 40, 40, 0.1);
  }

  step(timeStep: number): StepResult {
    const b3 = this.#b3;
    b3.b3World_Step(this.#world, timeStep, 4);
    b3.getEvents(this.#events, this.#world);

    let impact = false;
    if (!this.#impacted) {
      for (let index = 0; index < b3.getNumContactBeginEvents(this.#events); index += 1) {
        const touch = b3.getContactBeginEventAt(this.#touch, this.#events, index);
        const a = touch.shapeIdA.index1;
        const b = touch.shapeIdB.index1;
        if (
          (a === this.#ballShape && this.#targetShapes.has(b)) ||
          (b === this.#ballShape && this.#targetShapes.has(a))
        ) {
          impact = true;
          this.#impacted = true;
          break;
        }
      }
    }

    const moved: number[] = [];
    for (let index = 0; index < b3.getNumBodyMoveEvents(this.#events); index += 1) {
      const event = b3.getBodyMoveEventAt(this.#move, this.#events, index);
      const body = this.#bodyIndex.get(event.bodyId.index1);
      if (body === undefined) continue;
      this.#writePose(body, event.position, event.rotation);
      moved.push(body);
    }
    return { moved, impact };
  }

  destroy(): void {
    this.#b3.destroyEventsBuffer(this.#events);
    this.#b3.b3DestroyWorld(this.#world);
  }

  #writePose(index: number, position: readonly number[], rotation: readonly number[]): void {
    const offset = index * POSE_STRIDE;
    this.poses.set(position, offset);
    this.poses.set(rotation, offset + 3);
  }
}
