/* @workflow {
  "name": "hero:hole-check",
  "summary": "Capture the black-hole finale and verify paper collapse, explosion, blackness, and replay on WebGPU.",
  "requirements": "Workspace dependencies, baked hero assets, and GPU-enabled Chromium through Vitexec.",
  "writes": "apps/hero/.cache/hole.png and stdout",
  "args": ["--gpu", "--timeout", "180", "--screenshot", ".cache/hole.png"]
} */
import { Text } from '@pmndrs/glyph/three';
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

import type { TitleBodies } from '../src/letters/traits';
const { POP_AT } = (await import(
  new URL('/src/black-hole/content.ts', location.origin).href
)) as typeof import('../src/black-hole/content');
const { uHoleCollapse } = (await import(
  new URL('/src/black-hole/materials.ts', location.origin).href
)) as typeof import('../src/black-hole/materials');
const { blackHoleActions } = (await import(
  new URL('/src/black-hole/actions.ts', location.origin).href
)) as typeof import('../src/black-hole/actions');
const { STAR_SYMBOLS, EMBER_SECONDS } = (await import(
  new URL('/src/star-embers/traits.ts', location.origin).href
)) as typeof import('../src/star-embers/traits');
const { uEmberBloom, uEmberFire } = (await import(
  new URL('/src/star-embers/materials.ts', location.origin).href
)) as typeof import('../src/star-embers/materials');
const handles = globalThis as {
  heroWorld?: import('koota').World;
  heroHole?: { state(): import('../src/black-hole/traits').HoleState };
  heroTitle?: TitleBodies;
  heroRobot?: { hold(at: number): void };
};

while (document.documentElement.dataset.heroState !== 'ready')
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const { dismissBlackHole: dismissCollapse, holdBlackHole: holdCollapse } = blackHoleActions(handles.heroWorld!);
const { actions } = (await import(new URL('/src/actions.ts', location.origin).href)) as typeof import('../src/actions');
const { replayHero: requestReplay } = actions(handles.heroWorld!);
const hole = handles.heroHole!.state;
const state = _roots.values().next().value!.store.getState();
state.setFrameloop('never');
const { renderer, renderPipeline } = state;

if (!(renderer instanceof WebGPURenderer) || !(renderer.backend instanceof WebGPUBackend) || renderPipeline === null) {
  throw new Error('The finale check requires WebGPU and the actual post-processing pipeline');
}

renderer.onDeviceLost = (info) => {
  throw new Error(`WebGPU device lost: ${info.message}`);
};

requestReplay();
handles.heroRobot!.hold(9);
const scheduler = getScheduler();
const base = performance.now();
scheduler.step(base);
dismissCollapse();
const movingSheet = state.scene.getObjectByName('icon-pattern--6')?.parent;

if (movingSheet === null || movingSheet === undefined) throw new Error('Missing the foreground icon sheet');

const initialScroll = movingSheet.position.x;
const moments = [0.65, 1.4, 2, 2.95, POP_AT + 0.12, POP_AT + EMBER_SECONDS] as const;
const tiles = moments.map(() => new RenderTarget(640, 360));
let elapsed = 0;
let clock = base;
const stats: { time: number; lit: number; bright: number; total: number }[] = [];

// PassNode updates once per renderer frame. Capture on its native animation callback so every tile samples
// the current scene, even when many deterministic simulation steps ran within one JavaScript task.
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

const litPixels = (pixels: ArrayLike<number>, threshold = 8) => {
  let lit = 0;

  for (let i = 0; i < pixels.length; i += 4)
    if (Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) > threshold) lit++;

  return lit;
};

for (const [index, moment] of moments.entries()) {
  while (elapsed < moment) {
    const delta = Math.min(1 / 60, moment - elapsed);
    elapsed += delta;
    clock += delta * 1000;
    holdCollapse(elapsed);
    scheduler.step(clock);
  }

  if (index === 0 && Math.abs(movingSheet.position.x - initialScroll) < 0.5) {
    throw new Error('The background stopped scrolling as soon as the hole appeared');
  }

  if (Math.abs(hole().time - moment) > 0.02) throw new Error('The scheduler did not advance the held beat');

  const tile = tiles[index]!;
  const pixels = await capture(tile);
  stats.push({ time: moment, lit: litPixels(pixels), bright: litPixels(pixels, 160), total: tile.width * tile.height });
  renderer.setRenderTarget(null);
}

// A disabled-collapse control must restore the paper at the same scene state.
holdCollapse(2.95);
scheduler.step(clock + 16.667);
uHoleCollapse.value = 0;
const control = new RenderTarget(640, 360);
const uncollapsed = litPixels(await capture(control));

if (stats[3]!.lit >= uncollapsed * 0.4)
  throw new Error(`Paper failed to collapse: ${JSON.stringify({ stats, uncollapsed })}`);

if (
  stats[4]!.lit < 100 ||
  stats[4]!.bright > stats[4]!.total * 0.08 ||
  stats[4]!.lit > stats[4]!.total * 0.3 ||
  stats[5]!.lit !== 0
)
  throw new Error(`Explosion/black frame failed: ${JSON.stringify(stats)}`);

const burst = state.scene.getObjectByName('star-embers');

if (burst === undefined) throw new Error('Missing the ejected glyphs');

burst.traverse((object) => {
  if (object instanceof Text && !STAR_SYMBOLS.some((symbol) => symbol === object.text)) {
    throw new Error(`Unexpected star glyph: ${object.text}`);
  }
});

holdCollapse(POP_AT + 0.12);
scheduler.step(clock + 33.334);
const emitted = await capture(control);
uEmberFire.value = 0;
const flatStars = await capture(control);
uEmberFire.value = 1;
let burningPixels = 0;

for (let offset = 0; offset < emitted.length; offset += 4) {
  if (
    Math.max(
      Math.abs(emitted[offset]! - flatStars[offset]!),
      Math.abs(emitted[offset + 1]! - flatStars[offset + 1]!),
      Math.abs(emitted[offset + 2]! - flatStars[offset + 2]!),
    ) > 8
  )
    burningPixels++;
}

if (burningPixels < 100) throw new Error(`The burning material has no visible effect: ${burningPixels}`);

burst.visible = false;
const sparksOnly = await capture(control);
burst.visible = true;
let glyphPixels = 0;

for (let offset = 0; offset < emitted.length; offset += 4) {
  if (
    Math.max(
      Math.abs(emitted[offset]! - sparksOnly[offset]!),
      Math.abs(emitted[offset + 1]! - sparksOnly[offset + 1]!),
      Math.abs(emitted[offset + 2]! - sparksOnly[offset + 2]!),
    ) > 8
  )
    glyphPixels++;
}

if (glyphPixels < 100)
  throw new Error(
    `The pop did not emit visible glyphs: ${JSON.stringify({ glyphPixels, stats, emitted: litPixels(emitted), sparksOnly: litPixels(sparksOnly) })}`,
  );

uEmberBloom.value = 0;
const withoutBloom = await capture(control);
uEmberBloom.value = 0.75;
let bloomPixels = 0;

for (let offset = 0; offset < emitted.length; offset += 4) {
  if (
    Math.max(
      emitted[offset]! - withoutBloom[offset]!,
      emitted[offset + 1]! - withoutBloom[offset + 1]!,
      emitted[offset + 2]! - withoutBloom[offset + 2]!,
    ) > 8
  )
    bloomPixels++;
}

if (bloomPixels < 100) throw new Error(`The stars have no visible bloom: ${bloomPixels}`);

holdCollapse(POP_AT + 0.8);
scheduler.step(clock + 50.001);
const embers = await capture(control);
const lingeringStars = litPixels(embers);

if (lingeringStars < 100 || lingeringStars >= litPixels(emitted)) {
  throw new Error(`The stars did not linger and fade: ${lingeringStars}`);
}

uEmberBloom.value = 0;
const embersWithoutBloom = await capture(control);
uEmberBloom.value = 0.75;
let emberGlowPixels = 0;

for (let offset = 0; offset < embers.length; offset += 4) {
  if (
    Math.max(
      embers[offset]! - embersWithoutBloom[offset]!,
      embers[offset + 1]! - embersWithoutBloom[offset + 1]!,
      embers[offset + 2]! - embersWithoutBloom[offset + 2]!,
    ) > 4
  )
    emberGlowPixels++;
}

if (emberGlowPixels < 100) throw new Error(`The fading embers lost their glow: ${emberGlowPixels}`);

requestReplay();
scheduler.step(clock + 66.668);
const replay = litPixels(await capture(control));

if (replay < uncollapsed * 0.85) throw new Error('Replay did not restore the paper');

const sheet = new Scene();
// Letterbox the 16:9 captures within each cell of the 3-by-2 sheet.
const quad = new PlaneGeometry(1, 2 / 3);

const materials = tiles.map((tile, index) => {
  const material = new MeshBasicNodeMaterial({ toneMapped: false });
  material.fragmentNode = vec4(texture(tile.texture, uv().flipY()).rgb, 1);
  const mesh = new Mesh(quad, material);
  mesh.position.set((index % 3) - 1, index < 3 ? 0.5 : -0.5, 0);
  sheet.add(mesh);

  return material;
});

const camera = new OrthographicCamera(-1.5, 1.5, 1, -1, 0.1, 10);
camera.position.z = 1;
renderer.setRenderTarget(null);
renderer.render(sheet, camera);
console.log(
  'hero-hole-ready',
  JSON.stringify({
    backend: 'webgpu',
    stats,
    uncollapsed,
    glyphPixels,
    burningPixels,
    bloomPixels,
    lingeringStars,
    emberGlowPixels,
    replay,
  }),
);
quad.dispose();
materials.forEach((material) => material.dispose());
tiles.forEach((tile) => tile.dispose());
control.dispose();
