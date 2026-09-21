/* @workflow {
  "name": "hero:rain-check",
  "summary": "Rain glyphs in play on WebGPU and verify the glass projection casts their shadows and caustics.",
  "requirements": "Workspace dependencies, baked hero assets, and GPU-enabled Chromium through Vitexec.",
  "writes": "apps/hero/.cache/rain.png and stdout",
  "args": ["--gpu", "--timeout", "180", "--screenshot", ".cache/rain.png"]
} */
import { _roots, getScheduler } from '@react-three/fiber/webgpu';
import { RenderTarget, WebGPUBackend, WebGPURenderer } from 'three/webgpu';

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
const { Title, ShadowView } = (await import(
  new URL('/src/letters/traits.ts', location.origin).href
)) as typeof import('../src/letters/traits');
const { updateGlassShadows } = (await import(
  new URL('/src/letters/shadows.tsx', location.origin).href
)) as typeof import('../src/letters/shadows');
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

// The projection's captures of the rain: those whose original hangs under the rain's root.
const projection = world.queryFirst(Title)!.get(ShadowView)!;
const shades = projection.captures.filter(({ original }) => {
  let parent = original.parent;

  while (parent !== null && parent.name !== 'glyph-rain') parent = parent.parent;

  return parent !== null;
});

if (shades.length === 0) throw new Error('The projection captured no rain');

// The projection renders in the frame job, so it is run again by hand after each change to its sources.
const target = new RenderTarget(1280, 720);
const shaded = await capture(target);

for (const { capture: mesh } of shades) projection.sourceScene.remove(mesh);

updateGlassShadows(world);
const bare = await capture(target);

for (const { capture: mesh } of shades) projection.sourceScene.add(mesh);

updateGlassShadows(world);

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
