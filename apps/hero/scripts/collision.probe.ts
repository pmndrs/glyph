/* @workflow {
  "name": "hero:collision-check",
  "summary": "Verify real glyph colliders stay on the floor and separate after the robot pushes the title.",
  "requirements": "Workspace dependencies, baked hero assets, and GPU-enabled Chromium through Vitexec.",
  "writes": "apps/hero/.cache/collision.png and collision measurements to stdout",
  "args": ["--gpu", "--timeout", "120", "--screenshot", ".cache/collision.png"]
} */
import { _roots } from '@react-three/fiber/webgpu';
import { WebGPUBackend, WebGPURenderer } from 'three/webgpu';
import {
  collideShapeVsShape,
  createAllCollideShapeCollector,
  createDefaultCollideShapeSettings,
  rigidBody,
} from 'crashcat';
import type { World } from 'koota';
const { Body, Physics } = (await import(
  new URL('/src/physics/traits.ts', location.origin).href
)) as typeof import('../src/physics/traits');
const { Title } = (await import(
  new URL('/src/letters/traits.ts', location.origin).href
)) as typeof import('../src/letters/traits');
const { Robot } = (await import(
  new URL('/src/robot/traits.ts', location.origin).href
)) as typeof import('../src/robot/traits');

while (document.documentElement.dataset.heroState !== 'ready')
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const state = _roots.values().next().value!.store.getState();

if (!(state.renderer instanceof WebGPURenderer) || !(state.renderer.backend instanceof WebGPUBackend))
  throw new Error('Collision verification requires WebGPU');

const world = (globalThis as { heroWorld?: World }).heroWorld;

if (world === undefined) throw new Error('Missing the hero world');

const robot = world.queryFirst(Robot)!;
const pieces = world.queryFirst(Title)!.get(Title)!.bodies!.pieces;
const engine = world.get(Physics)!.engine;
const bodies = pieces.map(({ entity }) => rigidBody.get(engine, entity.get(Body)!.id)!);

while (robot.get(Robot)!.time === undefined)
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const beforePush = bodies.map((body) => [body.position[0], body.position[1]]);

while ((robot.get(Robot)!.time ?? 0) < 2.8)
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

state.setFrameloop('never');
const collector = createAllCollideShapeCollector();
const settings = createDefaultCollideShapeSettings();
settings.maxSeparationDistance = 0;

function penetration(a: (typeof bodies)[number], b: (typeof bodies)[number]): number {
  collector.reset();
  collideShapeVsShape(
    collector,
    settings,
    a.shape,
    0,
    0,
    ...a.position,
    ...a.quaternion,
    1,
    1,
    1,
    b.shape,
    0,
    0,
    ...b.position,
    ...b.quaternion,
    1,
    1,
    1,
  );

  return Math.max(0, ...collector.hits.map((hit) => hit.penetration));
}

// A coincident collider must fail the same overlap measurement used for the title.
if (penetration(bodies[0]!, bodies[0]!) < 0.2) throw new Error('Collision overlap control was not detected');

let worstPenetration = 0;

for (let index = 0; index < bodies.length; index++) {
  const body = bodies[index]!;

  // The solver permits 0.02 units of contact penetration, far below a letter's 0.8 thickness.
  if (Math.abs(body.position[2] - pieces[index]!.letter.home[2]) > 0.04)
    throw new Error(`Letter ${index} left the floor: ${body.position[2]}`);

  for (let other = index + 1; other < bodies.length; other++)
    worstPenetration = Math.max(worstPenetration, penetration(body, bodies[other]!));
}

if (worstPenetration > 0.04) throw new Error(`Letters intersect by ${worstPenetration} units`);

if (
  !bodies.some(
    (body, index) =>
      Math.hypot(body.position[0] - beforePush[index]![0]!, body.position[1] - beforePush[index]![1]!) > 0.25,
  )
)
  throw new Error('The robot did not move the letters');

console.log(
  'hero-collision-ready',
  JSON.stringify({
    backend: 'webgpu',
    worstPenetration,
    positions: bodies.map((body) => body.position),
  }),
);
