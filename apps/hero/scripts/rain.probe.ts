/* @workflow {
  "name": "hero:rain-check",
  "summary": "Rain glyphs in play on WebGPU and verify their projected shadows and caustics mark the paper.",
  "requirements": "Workspace dependencies, baked hero assets, and GPU-enabled Chromium through Vitexec.",
  "writes": "apps/hero/.cache/rain.png and stdout",
  "args": ["--gpu", "--timeout", "180", "--screenshot", ".cache/rain.png"]
} */
import { _roots, getScheduler } from '@react-three/fiber/webgpu';
import { type Object3D, RenderTarget, WebGPUBackend, WebGPURenderer } from 'three/webgpu';

const { world } = (await import(new URL('/src/world.ts', location.origin).href)) as typeof import('../src/world');
const { Rain } = (await import(
  new URL('/src/rain/traits.ts', location.origin).href
)) as typeof import('../src/rain/traits');
const { RAIN_AFTER } = (await import(
  new URL('/src/rain/content.ts', location.origin).href
)) as typeof import('../src/rain/content');
const { Mode } = (await import(
  new URL('/src/hero/traits.ts', location.origin).href
)) as typeof import('../src/hero/traits');
while (document.documentElement.dataset.heroState !== 'ready')
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const { actions } = (await import(new URL('/src/actions.ts', location.origin).href)) as typeof import('../src/actions');
const { pressHero } = actions(world);
const state = _roots.values().next().value!.store.getState();
state.setFrameloop('never');
const { renderer, renderPipeline } = state;

if (!(renderer instanceof WebGPURenderer) || !(renderer.backend instanceof WebGPUBackend) || renderPipeline === null) {
  throw new Error('The rain check requires WebGPU and the actual post-processing pipeline');
}

renderer.onDeviceLost = (info) => {
  throw new Error(`WebGPU device lost: ${info.message}`);
};

// A press before the title drops restarts straight into play, where the rain starts after its delay.
pressHero(0.3, -0.3);

if (world.get(Mode)!.kind !== 'play') throw new Error('The press did not start play');

const scheduler = getScheduler();
let clock = performance.now();

for (let frame = 0; frame < (RAIN_AFTER + 6) * 60; frame++) {
  clock += 1000 / 60;
  scheduler.step(clock);
}

const live = world.get(Rain)!.drops.filter((drop) => drop.phase === 'live');

if (live.length < 4) throw new Error(`Too few glyphs rained: ${live.length}`);

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

const shades: Object3D[] = [];
state.scene.traverse((object) => {
  if (object.name === 'rain-shade') shades.push(object);
});

if (shades.length === 0) throw new Error('The rain casts no shadows');

const target = new RenderTarget(1280, 720);
const shaded = await capture(target);

for (const shade of shades) shade.visible = false;

const bare = await capture(target);

for (const shade of shades) shade.visible = true;

// The shadows take paper away, and the caustics put tinted light back where the glyphs lie.
let darker = 0;
let brighter = 0;

for (let offset = 0; offset < shaded.length; offset += 4) {
  const difference =
    shaded[offset]! + shaded[offset + 1]! + shaded[offset + 2]! - bare[offset]! - bare[offset + 1]! - bare[offset + 2]!;

  if (difference < -24) darker++;
  else if (difference > 24) brighter++;
}

if (darker < 400 || brighter < 100)
  throw new Error(
    `The rain's shadows did not mark the paper: ${JSON.stringify({ darker, brighter, live: live.length })}`,
  );

target.dispose();
renderer.setRenderTarget(null);
renderPipeline.render();
console.log(
  'hero-rain-ready',
  JSON.stringify({ backend: 'webgpu', live: live.length, shadows: shades.length, darker, brighter }),
);
