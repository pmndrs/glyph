/* @workflow {
  "name": "hero:profile",
  "summary": "Weigh the hero frame on the GPU's own clock: each pass left out in turn at rest, then the finale's moments.",
  "requirements": "Workspace dependencies, baked hero assets, and GPU-enabled Chromium with timestamp queries through Vitexec.",
  "writes": "Per-configuration GPU frame times to stdout",
  "args": ["--gpu", "--timeout", "240", "--path", "/?profile"]
} */
import { _roots, getScheduler } from '@react-three/fiber/webgpu';
import { Mesh, type Object3D, WebGPUBackend, WebGPURenderer } from 'three/webgpu';

const { world } = (await import(new URL('/src/world.ts', location.origin).href)) as typeof import('../src/world');
const { Title, TitleView, ShadowView, LensView, FeatureView } = (await import(
  new URL('/src/letters/traits.ts', location.origin).href
)) as typeof import('../src/letters/traits');
const { Collapse } = (await import(
  new URL('/src/black-hole/traits.ts', location.origin).href
)) as typeof import('../src/black-hole/traits');
const { POP_AT } = (await import(
  new URL('/src/black-hole/content.ts', location.origin).href
)) as typeof import('../src/black-hole/content');
const { paperMaterial } = (await import(
  new URL('/src/hero/materials.ts', location.origin).href
)) as typeof import('../src/hero/materials');
while (document.documentElement.dataset.heroState !== 'ready')
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const { actions } = (await import(new URL('/src/actions.ts', location.origin).href)) as typeof import('../src/actions');
const {
  replayHero: requestReplay,
  mountShadowView,
  unmountShadowView,
  mountLensView,
  unmountLensView,
} = actions(world);
const state = _roots.values().next().value!.store.getState();
state.setFrameloop('never');
const { renderer, renderPipeline, scene } = state;

if (!(renderer instanceof WebGPURenderer) || !(renderer.backend instanceof WebGPUBackend) || renderPipeline === null) {
  throw new Error('The profile requires WebGPU and the actual post-processing pipeline');
}

// Three 0.185.1 owns these on the initialized backend. @types/three 0.185.4 omits them.
const backend = renderer.backend as WebGPUBackend & {
  trackTimestamp: boolean;
  device: { adapterInfo: { vendor: string } };
};

if (!backend.trackTimestamp) {
  throw new Error('The profile page did not enable timestamp queries, or the adapter has none');
}

renderer.onDeviceLost = (info) => {
  throw new Error(`WebGPU device lost: ${info.message}`);
};

requestReplay();
const scheduler = getScheduler();
let clock = performance.now();
const step = (frames: number) => {
  for (let frame = 0; frame < frames; frame++) {
    clock += 1000 / 60;
    scheduler.step(clock);
  }
};
const title = () => world.queryFirst(Title)!.get(Title)!;

// The title smashed down and at rest on the floor, the robot on its way.
while (title().bodies === undefined || title().bodies!.replays === 0 || title().bodies!.lifting) step(1);

step(90);

/** One frame: the simulation and views stepped once, the frame rendered once, and its GPU time resolved. */
const frame = async (): Promise<number> => {
  step(1);
  const previousLoop = renderer.getAnimationLoop();

  try {
    await new Promise<void>((resolve, reject) => {
      void renderer
        .setAnimationLoop(() => {
          try {
            renderPipeline.render();
            resolve();
          } catch (error) {
            reject(error);
          }
        })
        .catch(reject);
    });
  } finally {
    await renderer.setAnimationLoop(previousLoop);
  }

  await renderer.resolveTimestampsAsync('render');

  return renderer.info.render.timestamp;
};

const percentile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor((sorted.length - 1) * fraction)]!;
};

/** Median and 95th percentile GPU milliseconds over `count` frames, after a few to settle. */
const measure = async (count = 45) => {
  for (let warm = 0; warm < 6; warm++) await frame();

  const times: number[] = [];

  for (let index = 0; index < count; index++) times.push(await frame());

  return { p50: Number(percentile(times, 0.5).toFixed(2)), p95: Number(percentile(times, 0.95).toFixed(2)) };
};

const find = (test: (object: Object3D) => boolean): Object3D[] => {
  const found: Object3D[] = [];
  scene.traverse((object) => {
    if (test(object)) found.push(object);
  });

  return found;
};

const hide = (objects: Object3D[]) => {
  const shown = objects.map((object) => object.visible);
  objects.forEach((object) => (object.visible = false));

  return () => objects.forEach((object, index) => (object.visible = shown[index]!));
};

const titleEntity = world.queryFirst(Title)!;
const shadow = titleEntity.get(ShadowView)!;
const lens = titleEntity.get(LensView)!;
const receiver = find((object) => object.name === 'glass-shadows');
const icons = find((object) => object.name.startsWith('icon-pattern-'));
const paper = find((object) => object instanceof Mesh && object.material === paperMaterial);
const feature = titleEntity.get(FeatureView)?.line.glyphs;
const embers = find((object) => object.name === 'star-embers');

/** Each pass or layer left out in turn, at rest. Restoring puts the scene back as it was. */
const leaveOut: [string, () => () => void][] = [
  ['baseline', () => () => {}],
  [
    'shadow capture',
    () => {
      unmountShadowView();

      return () => mountShadowView(shadow);
    },
  ],
  [
    'shadow capture and receiver',
    () => {
      unmountShadowView();
      const restore = hide(receiver);

      return () => {
        restore();
        mountShadowView(shadow);
      };
    },
  ],
  ['shadow receiver', () => hide(receiver)],
  [
    'lens capture',
    () => {
      unmountLensView();

      return () => mountLensView(lens);
    },
  ],
  ['icon paper', () => hide(icons)],
  ['paper', () => hide(paper)],
  ['title glass', () => hide([titleEntity.get(TitleView)!.glyphs])],
  ['feature line', () => hide(feature === undefined ? [] : [feature])],
  ['embers', () => hide(embers)],
];

const atRest: Record<string, { p50: number; p95: number }> = {};

for (const [name, leave] of leaveOut) {
  const restore = leave();

  try {
    atRest[name] = await measure();
  } finally {
    restore();
  }
}

/** The finale's moments, everything drawn: the hole pulling, the paper collapsing, and the embers after the pop. */
const finale: Record<string, { p50: number; p95: number }> = {};

for (const [name, at] of [
  ['hole open', 1.5],
  ['paper collapsing', 2.9],
  ['embers', POP_AT + 0.3],
] as const) {
  world.set(Collapse, { openedAt: clock - at * 1000 });
  finale[name] = await measure(30);
}

const baseline = atRest['baseline']!;
const weight = Object.fromEntries(
  Object.entries(atRest).map(([name, { p50 }]) => [name, Number((baseline.p50 - p50).toFixed(2))]),
);
console.log(
  'hero-profile',
  JSON.stringify({
    backend: 'webgpu',
    adapter: { vendor: backend.device.adapterInfo.vendor },
    drawingBuffer: [renderer.domElement.width, renderer.domElement.height],
    query: location.search,
    atRest,
    /** Milliseconds each leaves out of the resting frame's median. */
    weight,
    finale,
  }),
);
