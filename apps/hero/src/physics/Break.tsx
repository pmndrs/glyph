import type { Decorations, Glyphs } from '@pmndrs/glyph/three';
import { MeshTransmissionMaterial } from '@react-three/drei/webgpu';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import Box3D from 'box3d.js/inline';
import { use, useEffect, useRef, useState } from 'react';
import { Box3, Matrix4, Mesh, Plane, Quaternion, Raycaster, Vector2, Vector3, type Camera } from 'three/webgpu';

import { TITLE } from '../content';
import type { Director, DirectorState } from '../director/director';
import type { RegisteredText, TextRegistry } from '../scene/Words';
import { POSE_STRIDE, PoseStreamWriter, type PoseStream } from './stream';
import { BreakWorld, type BallSpec, type GlyphBodySpec } from './world';

const box3d = Box3D();

const STEP = 1 / 60;
const MAX_STEPS = 180;
const QUIET_STEPS_TO_FINISH = 20;
const REWIND_STEPS_PER_SECOND = 240;
const BALL_RADIUS = 0.6;
const BALL_SPEED = 20;
const BALL_START_DEPTH = 8;
/** Distance in front of the camera of the invisible pane the debris rebounds from. */
const FRONT_PANE_DISTANCE = 2.5;
/** Idle ball position, behind the opaque backdrop. */
const BALL_PARK = new Vector3(0, 0, -80);
/** The parked ball is drawn for its first frames so its shaders compile early, then hidden: its transmission
 * material re-renders the scene every frame it is visible. */
const BALL_WARMUP_FRAMES = 8;
/** Break-apart copies compile fresh materials, so preparation is spread across frames, finishing before the launch. */
const PREPARED_PER_FRAME = 2;

/** A Text already broken apart ahead of the launch; its glyphs replace it on screen until the content changes. */
interface Prepared {
  readonly source: RegisteredText;
  readonly signature: string;
  readonly glyphs: Glyphs;
  readonly decorations: Decorations | undefined;
}

interface Piece {
  readonly glyphs: Glyphs;
  readonly index: number;
  readonly original: Matrix4;
  /** body⁻¹ · glyphsWorld · original: the glyph's rigid offset from its body. */
  readonly offset: Matrix4;
  readonly glyphsWorldInverse: Matrix4;
}

interface Session {
  phase: 'live' | 'rewind';
  readonly pieces: readonly Piece[];
  world: BreakWorld | undefined;
  writer: PoseStreamWriter | undefined;
  stream: PoseStream | undefined;
  prev: Float32Array;
  cur: Float32Array;
  step: number;
  accumulator: number;
  quiet: number;
  impacted: boolean;
  cursor: number;
}

/** Development-only evidence of the last break, readable from DevTools as `heroBreak`. */
interface BreakReport {
  readonly bodies: number;
  readonly glyphMaterials: readonly string[];
  readonly first: Float32Array;
  readonly texts: readonly { id: string; glyphs: number; impactTarget: boolean }[];
  readonly ball: { start: readonly number[]; velocity: readonly number[] };
  readonly targets: number;
  impactStep?: number;
  steps?: number;
  bytes?: number;
  maxGlyphTravel?: number;
}
let breakReport: BreakReport | undefined;

/**
 * Breaks every Text apart ahead of time, then on launch simulates and records the impact and rewinds the recording
 * to the exact layout. The prepared glyphs stay on screen afterwards, so a loop never pays for a break-apart again.
 */
export function Break({ director, registry }: { readonly director: Director; readonly registry: TextRegistry }) {
  const b3 = use(box3d);
  const camera = useThree((state) => state.camera);
  const ball = useRef<Mesh>(null);
  const [prepared] = useState(() => new Map<string, Prepared>());
  const session = useRef<Session | undefined>(undefined);
  const frames = useRef(0);

  useEffect(
    () => () => {
      for (const entry of prepared.values()) release(entry);
      prepared.clear();
    },
    [prepared],
  );

  useFrame(
    (_, delta) => {
      const state = director.state;
      const mesh = ball.current;
      if (mesh === null) return;
      const current = session.current;
      frames.current += 1;
      mesh.visible = state.beat === 'break' || state.beat === 'rewind' || frames.current <= BALL_WARMUP_FRAMES;

      if (state.beat !== 'break' && state.beat !== 'rewind') {
        if (current !== undefined) {
          end(current);
          session.current = undefined;
        }
        reconcile(prepared, registry, state, PREPARED_PER_FRAME);
        mesh.position.copy(BALL_PARK);
        return;
      }

      if (current === undefined) {
        if (state.beat !== 'break') return;
        reconcile(prepared, registry, state, Number.POSITIVE_INFINITY);
        if (prepared.size < eligible(registry, state)) return;
        session.current = begin(b3, prepared, camera, state.aim);
        return;
      }

      if (current.phase === 'live' && state.beat === 'break') {
        advance(current, Math.min(delta, 1 / 20) * state.timeScale, director);
        pose(current, current.prev, current.cur, current.accumulator / STEP, mesh);
        return;
      }
      if (current.phase === 'rewind' && state.beat === 'rewind') {
        current.cursor -= delta * REWIND_STEPS_PER_SECOND;
        if (current.cursor <= 0) {
          end(current);
          session.current = undefined;
          mesh.position.copy(BALL_PARK);
          director.rewindComplete();
          return;
        }
        rewindPose(current, mesh);
      }
    },
    { phase: 'physics' },
  );

  return (
    <mesh ref={ball} position={BALL_PARK}>
      <sphereGeometry args={[BALL_RADIUS, 64, 64]} />
      <MeshTransmissionMaterial ior={1.5} resolution={512} roughness={0.04} thickness={0.9} transmission={1} />
    </mesh>
  );
}

/** The headline stays out of the break: it is typed after the rewind and only prepared once it is complete. */
function settled(id: string, state: DirectorState): boolean {
  return id !== 'headline' || state.beat === 'hold';
}

/** Texts that take part in the next break: settled and actually drawing something. */
function eligible(registry: TextRegistry, state: DirectorState): number {
  let count = 0;
  for (const [id, source] of registry) if (settled(id, state) && source.signature !== '') count += 1;
  return count;
}

/** Drops prepared copies whose Text changed, then prepares up to `budget` committed, settled Texts. */
function reconcile(
  prepared: Map<string, Prepared>,
  registry: TextRegistry,
  state: DirectorState,
  budget: number,
): void {
  for (const [id, entry] of prepared) {
    const live = registry.get(id);
    if (live === undefined || live.text !== entry.source.text || live.signature !== entry.signature) {
      release(entry);
      prepared.delete(id);
    }
  }
  let remaining = budget;
  for (const [id, source] of registry) {
    if (remaining <= 0) return;
    if (prepared.has(id) || !settled(id, state) || source.signature === '') continue;
    if (source.text.commitState().status !== 'committed') continue;
    prepared.set(id, prepare(source));
    remaining -= 1;
  }
}

function prepare(source: RegisteredText): Prepared {
  const [glyphs, decorations] = source.text.breakApart();
  source.text.parent?.add(glyphs);
  if (decorations !== undefined) source.text.parent?.add(decorations);
  source.text.visible = false;
  return { source, signature: source.signature, glyphs, decorations };
}

function release({ source, glyphs, decorations }: Prepared): void {
  glyphs.removeFromParent();
  glyphs.dispose();
  decorations?.removeFromParent();
  decorations?.dispose();
  source.text.visible = true;
}

function begin(
  b3: Awaited<typeof box3d>,
  prepared: ReadonlyMap<string, Prepared>,
  camera: Camera,
  aim: { readonly x: number; readonly y: number } | undefined,
): Session {
  const pieces: Piece[] = [];
  const specs: GlyphBodySpec[] = [];
  const center = new Vector3();
  const size = new Vector3();
  const worldPosition = new Vector3();
  const worldQuaternion = new Quaternion();
  const worldScale = new Vector3();
  const body = new Matrix4();
  const ink = new Box3();

  for (const { source, glyphs } of prepared.values()) {
    glyphs.updateWorldMatrix(true, false);
    const glyphsWorld = glyphs.matrixWorld.clone();
    const glyphsWorldInverse = glyphsWorld.clone().invert();
    glyphsWorld.decompose(worldPosition, worldQuaternion, worldScale);
    for (const measurement of glyphs.measurements) {
      ink.copy(measurement.localInkBounds);
      if (ink.isEmpty()) continue;
      ink.getCenter(center).applyMatrix4(glyphsWorld);
      ink.getSize(size).multiply(worldScale);
      body.compose(center, worldQuaternion, new Vector3(1, 1, 1));
      const offset = body.clone().invert().multiply(glyphsWorld).multiply(measurement.originalMatrix);
      pieces.push({
        glyphs,
        index: measurement.index,
        original: measurement.originalMatrix.clone(),
        offset,
        glyphsWorldInverse,
      });
      specs.push({
        position: [center.x, center.y, center.z],
        rotation: [worldQuaternion.x, worldQuaternion.y, worldQuaternion.z, worldQuaternion.w],
        halfExtents: [Math.max(size.x / 2, 0.05), Math.max(size.y / 2, 0.05), Math.max(size.y * 0.12, 0.15)],
        impactTarget: source.impactTarget,
      });
    }
  }

  const ball = launchBall(camera, aim);
  const world = new BreakWorld(b3, specs, ball, camera.position.z - FRONT_PANE_DISTANCE);
  const writer = new PoseStreamWriter(world.bodyCount);
  const cur = new Float32Array(world.bodyCount * POSE_STRIDE);
  writer.record(world.poses, [], cur);
  if (import.meta.env.DEV) {
    const materials = [...prepared.values()].flatMap(({ glyphs }) => glyphs.materials.map((material) => material.type));
    breakReport = {
      bodies: world.bodyCount,
      glyphMaterials: [...new Set(materials)],
      first: cur.slice(),
      texts: [...prepared].map(([id, entry]) => ({
        id,
        glyphs: entry.glyphs.count,
        impactTarget: entry.source.impactTarget,
      })),
      ball: { start: ball.position, velocity: ball.velocity },
      targets: specs.filter((spec) => spec.impactTarget).length,
    };
    Object.assign(globalThis, { heroBreak: breakReport });
  }
  return {
    phase: 'live',
    pieces,
    world,
    writer,
    stream: undefined,
    prev: cur.slice(),
    cur,
    step: 1,
    accumulator: 0,
    quiet: 0,
    impacted: false,
    cursor: 0,
  };
}

function launchBall(camera: Camera, aim: { readonly x: number; readonly y: number } | undefined): BallSpec {
  const target = new Vector3(TITLE.position[0], TITLE.position[1], TITLE.position[2]);
  if (aim !== undefined) {
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2(aim.x, aim.y), camera);
    ray.ray.intersectPlane(new Plane(new Vector3(0, 0, 1), 0), target);
  }
  const start = new Vector3(target.x * 0.4, target.y * 0.4 - 1.5, -BALL_START_DEPTH);
  const velocity = target.clone().sub(start).normalize().multiplyScalar(BALL_SPEED);
  return { position: [start.x, start.y, start.z], velocity: [velocity.x, velocity.y, velocity.z], radius: BALL_RADIUS };
}

function advance(session: Session, sceneDelta: number, director: Director): void {
  const { world, writer } = session;
  if (world === undefined || writer === undefined) return;
  session.accumulator += sceneDelta;
  while (session.accumulator >= STEP) {
    session.accumulator -= STEP;
    const { moved, impact } = world.step(STEP);
    if (impact) {
      session.impacted = true;
      director.contact();
      if (breakReport !== undefined) breakReport.impactStep = session.step;
    }
    [session.prev, session.cur] = [session.cur, session.prev];
    writer.record(world.poses, moved, session.cur);
    session.step += 1;
    session.quiet = moved.length === 0 ? session.quiet + 1 : 0;
    if (session.step >= MAX_STEPS || (session.impacted && session.quiet >= QUIET_STEPS_TO_FINISH)) {
      session.stream = writer.finish();
      session.writer = undefined;
      if (breakReport !== undefined) {
        breakReport.steps = session.stream.stepCount;
        breakReport.bytes = session.stream.byteLength;
        breakReport.maxGlyphTravel = maxTravel(breakReport.first, session.cur, session.pieces.length);
      }
      world.destroy();
      session.world = undefined;
      session.phase = 'rewind';
      session.cursor = session.stream.stepCount - 1;
      session.accumulator = 0;
      director.recordingComplete();
      return;
    }
  }
}

function rewindPose(session: Session, ball: Mesh): void {
  const stream = session.stream;
  if (stream === undefined) return;
  const lower = Math.floor(session.cursor);
  const upper = Math.min(lower + 1, stream.stepCount - 1);
  stream.decode(lower, session.prev);
  stream.decode(upper, session.cur);
  pose(session, session.prev, session.cur, session.cursor - lower, ball);
}

/** Destroys the world if it is still running and returns every glyph to its exact original matrix. */
function end(session: Session): void {
  session.world?.destroy();
  session.world = undefined;
  for (const piece of session.pieces) piece.glyphs.setMatrixAt(piece.index, piece.original);
}

const from = new Vector3();
const to = new Vector3();
const fromRotation = new Quaternion();
const toRotation = new Quaternion();
const bodyMatrix = new Matrix4();
const glyphMatrix = new Matrix4();
const unit = new Vector3(1, 1, 1);

/** Writes every glyph and the ball at `alpha` between two decoded steps. */
function pose(session: Session, a: Float32Array, b: Float32Array, alpha: number, ball: Mesh): void {
  for (const [body, piece] of session.pieces.entries()) {
    interpolate(a, b, body, alpha);
    bodyMatrix.compose(from, fromRotation, unit);
    glyphMatrix.multiplyMatrices(piece.glyphsWorldInverse, bodyMatrix).multiply(piece.offset);
    piece.glyphs.setMatrixAt(piece.index, glyphMatrix);
  }
  interpolate(a, b, session.pieces.length, alpha);
  ball.position.copy(from);
  ball.quaternion.copy(fromRotation);
}

function interpolate(a: Float32Array, b: Float32Array, body: number, alpha: number): void {
  const offset = body * POSE_STRIDE;
  from.set(a[offset] ?? 0, a[offset + 1] ?? 0, a[offset + 2] ?? 0);
  to.set(b[offset] ?? 0, b[offset + 1] ?? 0, b[offset + 2] ?? 0);
  from.lerp(to, alpha);
  fromRotation.set(a[offset + 3] ?? 0, a[offset + 4] ?? 0, a[offset + 5] ?? 0, a[offset + 6] ?? 1);
  toRotation.set(b[offset + 3] ?? 0, b[offset + 4] ?? 0, b[offset + 5] ?? 0, b[offset + 6] ?? 1);
  fromRotation.slerp(toRotation, alpha);
}

function maxTravel(first: Float32Array, last: Float32Array, glyphCount: number): number {
  let travel = 0;
  for (let body = 0; body < glyphCount; body += 1) {
    const offset = body * POSE_STRIDE;
    const dx = (last[offset] ?? 0) - (first[offset] ?? 0);
    const dy = (last[offset + 1] ?? 0) - (first[offset + 1] ?? 0);
    const dz = (last[offset + 2] ?? 0) - (first[offset + 2] ?? 0);
    travel = Math.max(travel, Math.hypot(dx, dy, dz));
  }
  return travel;
}
