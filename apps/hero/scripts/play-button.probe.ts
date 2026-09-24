/* @workflow {
  "name": "hero:play-button-check",
  "summary": "Draw the play button in on WebGPU, verify its label fills in block by block and hover brightens it, and tile the moments.",
  "requirements": "Workspace dependencies, baked hero assets, and GPU-enabled Chromium through Vitexec.",
  "writes": "apps/hero/.cache/play-button.png and stdout",
  "args": ["--gpu", "--timeout", "180", "--screenshot", ".cache/play-button.png"]
} */
import { _roots, getScheduler } from '@react-three/fiber/webgpu';
import { texture, uv, vec2, vec4 } from 'three/tsl';
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
const { Collapse } = (await import(
  new URL('/src/black-hole/traits.ts', location.origin).href
)) as typeof import('../src/black-hole/traits');
const { POP_AT } = (await import(
  new URL('/src/black-hole/content.ts', location.origin).href
)) as typeof import('../src/black-hole/content');
const { EMBER_SECONDS } = (await import(
  new URL('/src/star-embers/content.ts', location.origin).href
)) as typeof import('../src/star-embers/content');
const { BUTTON_HEIGHT, BUTTON_WIDTH, FRAME_MARGIN, REVEAL_AFTER, REVEAL_SECONDS } = (await import(
  new URL('/src/ui/content.ts', location.origin).href
)) as typeof import('../src/ui/content');
const { uPlayHover, uPlayReveal } = (await import(
  new URL('/src/ui/materials.ts', location.origin).href
)) as typeof import('../src/ui/materials');
const { Viewport } = (await import(
  new URL('/src/viewport/traits.ts', location.origin).href
)) as typeof import('../src/viewport/traits');
while (document.documentElement.dataset.heroState !== 'ready')
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const { actions } = (await import(new URL('/src/actions.ts', location.origin).href)) as typeof import('../src/actions');
const { replayScene: requestReplay } = actions(world);
const hole = () => world.get(Collapse)!.hole;
const state = _roots.values().next().value!.store.getState();
state.setFrameloop('never');
const { renderer, renderPipeline } = state;

if (!(renderer instanceof WebGPURenderer) || !(renderer.backend instanceof WebGPUBackend) || renderPipeline === null) {
  throw new Error('The play button check requires WebGPU and the actual post-processing pipeline');
}

renderer.onDeviceLost = (info) => {
  throw new Error(`WebGPU device lost: ${info.message}`);
};

requestReplay();
const scheduler = getScheduler();
let clock = performance.now();
scheduler.step(clock);

while (hole().beat === 'closed') {
  clock += 1000 / 60;
  scheduler.step(clock);
}

const capture = async (target: RenderTarget) => {
  const previousLoop = renderer.getAnimationLoop();

  try {
    await new Promise<void>((resolve, reject) => {
      void renderer
        .setAnimationLoop(() => {
          try {
            renderer.setRenderTarget(target);
            renderPipeline.render();
            resolve();
          } catch (error) {
            reject(error);
          }
        })
        .catch(reject);
    });

    return await renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height);
  } finally {
    await renderer.setAnimationLoop(previousLoop);
    renderer.setRenderTarget(null);
  }
};

/**
 * Pixels the button lights at all, pixels of the label bright enough to be its lit blocks, and the summed
 * brightness. The label is read inside the frame, so the frame's own stroke does not count as label.
 */
const measure = (pixels: ArrayLike<number>, width: number, height: number) => {
  const { aspect } = world.get(Viewport)!;
  let lit = 0;
  let bright = 0;
  let light = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const peak = Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!);
    const pixel = i / 4;
    const x = ((pixel % width) / width - 0.5) * 2 * aspect;
    const y = (Math.floor(pixel / width) / height - 0.5) * 2;
    const withinFrame = Math.abs(x) < BUTTON_WIDTH / 2 - 0.08 && Math.abs(y) < BUTTON_HEIGHT / 2 - 0.08;

    if (peak > 8) lit++;

    if (withinFrame && peak > 160) bright++;

    light += peak;
  }

  return { lit, bright, light };
};

/** Jump the finale to `seconds` after the embers went out, then step one frame so the views publish it. */
const emberAge = (seconds: number) => {
  clock += 1000 / 60;
  world.set(Collapse, { openedAt: clock - (POP_AT + EMBER_SECONDS + seconds) * 1000 });
  scheduler.step(clock);
};

const tiles = [0, 1, 2].map(() => new RenderTarget(1280, 720));
// The label half filled in, then whole, then under the pointer.
emberAge(REVEAL_AFTER + REVEAL_SECONDS * 0.55);
const filling = measure(await capture(tiles[0]!), 1280, 720);
const fillingReveal = uPlayReveal.value;
emberAge(REVEAL_AFTER + REVEAL_SECONDS + 0.2);
const label = measure(await capture(tiles[1]!), 1280, 720);
const labelReveal = uPlayReveal.value;
uPlayHover.value = 1;
const hovered = measure(await capture(tiles[2]!), 1280, 720);
uPlayHover.value = 0;

if (fillingReveal < 0.5 || fillingReveal > 0.62 || labelReveal !== 1) {
  throw new Error(`The reveal did not reach its moments: ${JSON.stringify({ fillingReveal, labelReveal })}`);
}

// Half way in, only some of the label's blocks have lit.
if (label.bright < 100 || filling.bright < 20 || filling.bright >= label.bright * 0.85) {
  throw new Error(`The label did not fill in block by block: ${JSON.stringify({ filling, label })}`);
}

if (hovered.light <= label.light * 1.05) {
  throw new Error(`Hover did not brighten the display: ${JSON.stringify({ label, hovered })}`);
}

// Tile the three moments, and a close look at the hovered module, for the screenshot.
const sheet = new Scene();
const quad = new PlaneGeometry(1, 9 / 16);
const { aspect } = world.get(Viewport)!;
const half = vec2((BUTTON_WIDTH / 2 + FRAME_MARGIN) / aspect, BUTTON_HEIGHT / 2 + FRAME_MARGIN);
const materials = tiles.map((tile, index) => {
  const material = new MeshBasicNodeMaterial({ toneMapped: false });
  material.fragmentNode = vec4(texture(tile.texture, uv().flipY()).rgb, 1);
  const mesh = new Mesh(quad, material);
  mesh.position.set(index - 1, 0.35, 0);
  sheet.add(mesh);

  return material;
});
const closeUp = new MeshBasicNodeMaterial({ toneMapped: false });
closeUp.fragmentNode = vec4(texture(tiles[2]!.texture, uv().sub(0.5).mul(half).mul(2).add(0.5).flipY()).rgb, 1);
const closeUpQuad = new PlaneGeometry(
  2.4,
  (2.4 * (BUTTON_HEIGHT + 2 * FRAME_MARGIN)) / (BUTTON_WIDTH + 2 * FRAME_MARGIN),
);
const closeUpMesh = new Mesh(closeUpQuad, closeUp);
closeUpMesh.position.set(0, -0.45, 0);
sheet.add(closeUpMesh);
const camera = new OrthographicCamera(-1.5, 1.5, 1, -1, 0.1, 10);
camera.position.z = 1;
renderer.setRenderTarget(null);
renderer.render(sheet, camera);
console.log(
  'hero-play-button-ready',
  JSON.stringify({ backend: 'webgpu', filling, label, hovered, fillingReveal, labelReveal }),
);
quad.dispose();
closeUpQuad.dispose();
closeUp.dispose();
materials.forEach((material) => material.dispose());
tiles.forEach((tile) => tile.dispose());
