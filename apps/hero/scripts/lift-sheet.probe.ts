/* @workflow {
  "name": "hero:lift-sheet",
  "summary": "Verify the automatic opening lift and tile four moments of its smash on WebGPU with deterministic physics.",
  "requirements": "Workspace dependencies, baked hero assets, and GPU-enabled Chromium through Vitexec.",
  "writes": "apps/hero/.cache/lift-sheet.png and stdout",
  "args": ["--gpu", "--timeout", "180", "--screenshot", ".cache/lift-sheet.png"]
} */
import { _roots, getScheduler } from '@react-three/fiber/webgpu';
import { texture, uv, vec4 } from 'three/tsl';
import {
  Mesh,
  MeshBasicNodeMaterial,
  OrthographicCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
  WebGPUBackend,
  WebGPURenderer,
} from 'three/webgpu';

import type { TitleBodies } from '../src/typography/bodies';
const { advanceHero } = (await import(
  new URL('/src/systems.ts', location.origin).href
)) as typeof import('../src/systems');
const { Time } = (await import(
  new URL('/src/time/traits.ts', location.origin).href
)) as typeof import('../src/time/traits');
const { Body } = (await import(
  new URL('/src/physics/traits.ts', location.origin).href
)) as typeof import('../src/physics/traits');
/** Seconds into the replay for each tile: carried up, at the top, falling, and landed. */
const MOMENTS = [0.3, 0.6, 0.85, 1.6] as const;
const STEP = 1 / 120;

while (document.documentElement.dataset.heroState !== 'ready')
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const state = _roots.values().next().value?.store.getState();

if (state === undefined) throw new Error('Hero did not mount');

state.setFrameloop('never');
const { renderer, scene, camera } = state;

if (!(renderer instanceof WebGPURenderer) || !(renderer.backend instanceof WebGPUBackend)) {
  throw new Error('The lift sheet must execute on WebGPU');
}

const title = (globalThis as { heroTitle?: TitleBodies }).heroTitle;

if (title === undefined) throw new Error('Missing the title development handle');

await renderer.compileAsync(scene, camera);

const tiles = MOMENTS.map(() => new RenderTarget(960, 540, { samples: 4 }));
const world = (globalThis as { heroWorld?: import('koota').World }).heroWorld;

if (world === undefined) throw new Error('Missing the hero world');

// Sample the adapter once after the readiness gate before taking over the deterministic clock.
getScheduler().stepJob('hero-simulation');
const frame = world.get(Time)!;
let clock = frame.now;

while (frame.elapsed < 1) {
  if (title.lifting) throw new Error('The title lifted before its opening beat');

  const delta = Math.min(STEP, 1 - frame.elapsed);
  clock += delta * 1000;
  advanceHero(world, delta, clock);
}

if (!title.lifting) throw new Error('The title did not lift automatically after its opening beat');

const base = clock;
let elapsed = 0;
const heights: number[] = [];

for (const [index, moment] of MOMENTS.entries()) {
  while (elapsed < moment) {
    advanceHero(world, STEP, base + (elapsed + STEP) * 1000);
    elapsed += STEP;
  }

  let height = 0;

  for (const piece of title.pieces) height = Math.max(height, piece.entity.get(Body)!.position[2]);

  heights.push(height);
  getScheduler().stepJob('hero-title-motion');
  getScheduler().stepJob('hero-glass-shadows');
  renderer.setRenderTarget(tiles[index] ?? null);
  renderer.render(scene, camera);
}

if (heights[0]! < 8 || heights[heights.length - 1]! > 1) {
  throw new Error(`The title did not lift and settle: ${JSON.stringify(heights)}`);
}

const sheet = new Scene();
const quad = new PlaneGeometry(1, 1);

const materials = tiles.map((tile, index) => {
  const material = new MeshBasicNodeMaterial({ toneMapped: false });
  // Render textures are top-down. The sheet reads them upright.
  material.fragmentNode = vec4(texture(tile.texture, uv().flipY()).rgb, 1);
  const mesh = new Mesh(quad, material);
  mesh.position.set(index % 2 === 0 ? -0.5 : 0.5, index < 2 ? 0.5 : -0.5, 0);
  sheet.add(mesh);

  return material;
});

const sheetCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
sheetCamera.position.z = 1;
renderer.setRenderTarget(null);
renderer.render(sheet, sheetCamera);
console.log(
  'hero-lift-sheet-ready',
  JSON.stringify({
    backend: 'webgpu',
    moments: MOMENTS,
    heights,
    poses: title.pieces.map(({ entity }) => entity.get(Body)!.position),
  }),
);

quad.dispose();

for (const material of materials) material.dispose();

for (const tile of tiles) tile.dispose();
