/* @workflow {
  "name": "hero:lift-sheet",
  "summary": "Tile four moments of the title's lift and smash on WebGPU, stepping the physics deterministically.",
  "requirements": "Workspace dependencies, baked hero assets, and GPU-enabled Chromium through Vitexec.",
  "writes": "apps/hero/.cache/lift-sheet.png and stdout",
  "args": ["--gpu", "--timeout", "180", "--screenshot", ".cache/lift-sheet.png"]
} */
import { _roots, getScheduler } from '@react-three/fiber/webgpu';
import { Text } from '@pmndrs/glyph/three';
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

import type { HoleState } from '../src/scene/hole';
import type { TitleBodies } from '../src/scene/title-bodies';
const { replayTitle, updateTitle } = (await import(
  new URL('/src/scene/title-bodies.ts', location.origin).href
)) as typeof import('../src/scene/title-bodies');

/** Seconds into the replay for each tile: carried up, at the top, falling, and landed. */
const MOMENTS = [0.3, 0.6, 0.85, 1.6] as const;
const STEP = 1 / 120;
/** The black hole stays closed for the whole sheet: only the lift and smash are on it. */
const CLOSED: HoleState = {
  beat: 'closed',
  time: -1,
  x: 0,
  y: 0,
  horizon: 0,
  pull: 0,
  presence: 0,
  sincePop: undefined,
  blackout: 0,
};

function ready() {
  const scene = _roots.values().next().value?.store.getState().scene;
  let feature = false;
  scene?.traverse((object) => {
    if (object instanceof Text && object.text.startsWith('SHAPING') && object.style.opacity === 1) {
      feature = object.commitState().status === 'committed';
    }
  });
  const title = (globalThis as { heroTitle?: TitleBodies }).heroTitle;
  return feature && scene?.environment && scene.getObjectByName('glass-shadows') && title !== undefined;
}
while (document.documentElement.dataset.heroState !== 'ready')
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
while (!ready()) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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
replayTitle(title);
let elapsed = 0;
for (const [index, moment] of MOMENTS.entries()) {
  while (elapsed < moment) {
    updateTitle(title, STEP, undefined, CLOSED);
    elapsed += STEP;
  }
  getScheduler().stepJob('hero-glass-shadows');
  renderer.setRenderTarget(tiles[index] ?? null);
  renderer.render(scene, camera);
}

const sheet = new Scene();
const quad = new PlaneGeometry(1, 1);
const materials = tiles.map((tile, index) => {
  const material = new MeshBasicNodeMaterial({ toneMapped: false });
  // Render textures are top-down; the sheet reads them upright.
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
  JSON.stringify({ backend: 'webgpu', moments: MOMENTS, poses: Array.from(title.world.poses) }),
);

quad.dispose();
for (const material of materials) material.dispose();
for (const tile of tiles) tile.dispose();
