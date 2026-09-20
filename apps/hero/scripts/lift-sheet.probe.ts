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

const { world } = (await import(new URL('/src/world.ts', location.origin).href)) as typeof import('../src/world');
const { Title } = (await import(
  new URL('/src/letters/traits.ts', location.origin).href
)) as typeof import('../src/letters/traits');
const { Time } = (await import(
  new URL('/src/time/traits.ts', location.origin).href
)) as typeof import('../src/time/traits');
const { Body } = (await import(
  new URL('/src/physics/traits.ts', location.origin).href
)) as typeof import('../src/physics/traits');
const { Keys } = (await import(
  new URL('/src/input/traits.ts', location.origin).href
)) as typeof import('../src/input/traits');
/** Seconds into the replay for each tile: carried up, at the top, falling, and landed. */
const MOMENTS = [0.3, 0.6, 0.85, 1.6] as const;
const STEP = 1 / 60;

while (document.documentElement.dataset.heroState !== 'ready') {
  const time = world.get(Time)!;

  if (time.now !== 0 || time.delta !== 0 || time.elapsed !== 0) {
    throw new Error('The playback clock advanced during preparation');
  }

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

const state = _roots.values().next().value?.store.getState();

if (state === undefined) throw new Error('Hero did not mount');

state.setFrameloop('never');
const { renderer, scene, camera } = state;

if (!(renderer instanceof WebGPURenderer) || !(renderer.backend instanceof WebGPUBackend)) {
  throw new Error('The lift sheet must execute on WebGPU');
}

const title = world.queryFirst(Title)!.get(Title)!.bodies!;

await renderer.compileAsync(scene, camera);

const tiles = MOMENTS.map(() => new RenderTarget(960, 540, { samples: 4 }));
// Sample the adapter once after the readiness gate before taking over the deterministic clock.
getScheduler().step(performance.now());
let clock = world.get(Time)!.now;

while (world.get(Time)!.elapsed < 1) {
  if (title.lifting) throw new Error('The title lifted before its opening beat');

  clock += STEP * 1000;
  getScheduler().step(clock);
}

if (!title.lifting) throw new Error('The title did not lift automatically after its opening beat');

const base = clock;
let elapsed = 0;
const heights: number[] = [];

for (const [index, moment] of MOMENTS.entries()) {
  while (elapsed < moment) {
    getScheduler().step(base + (elapsed + STEP) * 1000);
    elapsed += STEP;
  }

  let height = 0;

  for (const piece of title.pieces) height = Math.max(height, piece.entity.get(Body)!.position[2]);

  heights.push(height);
  renderer.setRenderTarget(tiles[index] ?? null);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
}

if (
  heights[0]! < 8 ||
  title.pieces.some(({ entity, letter }) => Math.abs(entity.get(Body)!.position[2] - letter.home[2]) > 0.04)
) {
  throw new Error(`The title did not lift and settle: ${JSON.stringify(heights)}`);
}

const replays = title.replays;
const input = document.createElement('input');
document.body.append(input);
input.focus();
const typing = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
input.dispatchEvent(typing);

if (typing.defaultPrevented || title.replays !== replays || world.get(Keys)!.has(' ')) {
  throw new Error('Typing in a form control reached hero keyboard input');
}

input.remove();
window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat: true }));
window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));

if (title.replays !== replays + 1 || !title.lifting || !world.get(Keys)!.has(' ')) {
  throw new Error('Holding Space must start exactly one replay and retain the held key');
}

window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));

if (world.get(Keys)!.has(' ')) throw new Error('Releasing Space left it held');

window.dispatchEvent(new KeyboardEvent('keydown', { key: 'W' }));

if (!world.get(Keys)!.has('w')) throw new Error('Keyboard state did not normalize the held key');

window.dispatchEvent(new Event('blur'));

if (world.get(Keys)!.size !== 0) throw new Error('Losing focus left keys held');

window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));

if (title.replays !== replays + 2) throw new Error('A new Space press did not replay after focus loss');

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
