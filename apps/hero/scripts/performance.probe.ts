/* @workflow {
  "name": "hero:performance",
  "summary": "Play the hero through: the sequence, Play into play fed to its finale, and a replay. Reject late shader compilation, mesh creation, or asset loads after preparation, and report every hitch.",
  "requirements": "Workspace dependencies, baked hero assets, and GPU-enabled Chromium through Vitexec.",
  "writes": "Per-stage frame, CPU, per-job, and GPU timings, hitch frames, long tasks, late work, and environment details to stdout",
  "args": ["--gpu", "--timeout", "300", "--path", "/?profile"]
} */
import { _roots, getScheduler } from '@react-three/fiber/webgpu';
import { vec4 } from 'three/tsl';
import { Mesh, MeshBasicNodeMaterial, PlaneGeometry, Scene, WebGPUBackend, WebGPURenderer } from 'three/webgpu';
const { world } = (await import(new URL('/src/world.ts', location.origin).href)) as typeof import('../src/world');
const { actions } = (await import(new URL('/src/actions.ts', location.origin).href)) as typeof import('../src/actions');
const { Collapse } = (await import(
  new URL('/src/black-hole/traits.ts', location.origin).href
)) as typeof import('../src/black-hole/traits');
const { Mode } = (await import(
  new URL('/src/director/traits.ts', location.origin).href
)) as typeof import('../src/director/traits');
const { Rain } = (await import(
  new URL('/src/rain/traits.ts', location.origin).href
)) as typeof import('../src/rain/traits');
const { Body } = (await import(
  new URL('/src/physics/traits.ts', location.origin).href
)) as typeof import('../src/physics/traits');
const { Time } = (await import(
  new URL('/src/time/traits.ts', location.origin).href
)) as typeof import('../src/time/traits');
const { PlayButton } = (await import(
  new URL('/src/ui/traits.ts', location.origin).href
)) as typeof import('../src/ui/traits');

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

while (document.documentElement.dataset.heroState !== 'ready') {
  if (document.documentElement.dataset.heroState === 'failed')
    throw new Error(document.querySelector('output')?.textContent ?? 'Preparation failed');

  await nextFrame();
}

const state = _roots.values().next().value?.store.getState();

if (state === undefined) throw new Error('Hero did not mount');

const { renderer, scene, camera, renderPipeline } = state;

if (!(renderer instanceof WebGPURenderer) || !(renderer.backend instanceof WebGPUBackend) || renderPipeline === null) {
  throw new Error('Hero performance requires WebGPU and the complete post pipeline');
}

renderer.onDeviceLost = (info) => {
  throw new Error(info.message);
};

// Three 0.185.1 implements these backend methods. @types/three 0.185.4 omits them.
const backend = renderer.backend as WebGPUBackend & {
  createProgram(...args: unknown[]): void;
  createRenderPipeline(...args: unknown[]): void;
  device: {
    adapterInfo: { vendor: string; architecture: string; device: string; description: string };
    queue: { onSubmittedWorkDone(): Promise<void> };
  };
};
const program = backend.createProgram;
const pipeline = backend.createRenderPipeline;
/** Where the playthrough is: the sequence, play from the Play button to its finale, and a replay after it. */
let stage = 'sequence';
const late: { kind: 'program' | 'pipeline'; name: string; stage: string; beat: string; at: number; frame: number }[] =
  [];
const beat = () => world.get(Collapse)!.hole;

/** Which draw a late program or pipeline was for: the shader stage and name, or the material and the mesh. */
const lateWork = (kind: 'program' | 'pipeline', name: string) =>
  late.push({ kind, name, stage, beat: beat().beat, at: beat().time, frame: samples.length });

backend.createProgram = function (...args) {
  const shader = args[0] as { stage: string; name: string };
  lateWork('program', `${shader.stage}:${shader.name}`);
  program.apply(this, args);
};

backend.createRenderPipeline = function (...args) {
  const draw = args[0] as { material: { name: string; type: string }; object: { name: string; type: string } };
  lateWork('pipeline', `${draw.material.name || draw.material.type} on ${draw.object.name || draw.object.type}`);
  pipeline.apply(this, args);
};

const meshIds = () => {
  const ids = new Set<number>();

  scene.traverse((object) => {
    if (object instanceof Mesh) ids.add(object.id);
  });

  return ids;
};

const preparedMeshes = meshIds();
const newMeshes = new Map<number, string>();
const heapSamples: number[] = [];
type Sample = {
  at: number;
  stage: string;
  mode: string;
  beat: string;
  time: number;
  cpuMs: number;
  jobs: Record<string, number>;
  gpuMs?: number;
  drawCalls?: number;
};
const samples: Sample[] = [];
const pendingFrames = new Set<Promise<void>>();
const longTasks: { stage: string; at: number; duration: number }[] = [];

const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) longTasks.push({ stage, at: entry.startTime, duration: entry.duration });
});

observer.observe({ type: 'longtask' });
const scheduler = getScheduler();
// Each job's own CPU time within the frame. The scheduler reads a job's callback when it runs it, so wrapping the
// callbacks it holds weighs every job without touching the application.
type Callback = (...args: unknown[]) => unknown;
type Job = { id: string; callback: Callback };
const roots = (scheduler as unknown as { roots: Map<string, { jobs: Map<string, Job> }> }).roots;
const wrapped: { job: Job; callback: Callback }[] = [];
let frameJobs: Record<string, number> = {};

for (const root of roots.values()) {
  for (const job of root.jobs.values()) {
    const callback = job.callback;
    wrapped.push({ job, callback });

    job.callback = function (this: unknown, ...args: unknown[]) {
      const start = performance.now();

      try {
        return callback.apply(this, args);
      } finally {
        frameJobs[job.id] = (frameJobs[job.id] ?? 0) + performance.now() - start;
      }
    };
  }
}

let frameStart = 0;
let rendered: Sample | undefined;

const stopBefore = scheduler.registerGlobal('before', 'hero-profile-start', () => {
  frameStart = performance.now();
  frameJobs = {};
  rendered = undefined;
});

const stopAfter = scheduler.registerGlobal('after', 'hero-profile-end', () => {
  if (rendered === undefined) return;

  rendered.cpuMs = performance.now() - frameStart;
  rendered.jobs = frameJobs;
});

const render = renderPipeline.render;

renderPipeline.render = function () {
  const at = performance.now();
  render.call(this);
  const hole = beat();
  const sample: Sample = {
    at,
    stage,
    mode: world.get(Mode)!.kind,
    beat: hole.beat,
    time: hole.time,
    cpuMs: 0,
    jobs: {},
  };
  samples.push(sample);
  rendered = sample;
  const reading = (performance as { memory?: { usedJSHeapSize: number } }).memory;

  if (reading !== undefined) heapSamples.push(reading.usedJSHeapSize);

  // The GPU's own clock across every render pass of the frame, from timestamp queries the profile page enables.
  const completion = backend.device.queue.onSubmittedWorkDone().then(async () => {
    await renderer.resolveTimestampsAsync('render');
    sample.gpuMs = renderer.info.render.timestamp;
    sample.drawCalls = renderer.info.render.drawCalls;
    pendingFrames.delete(completion);
  });

  pendingFrames.add(completion);
};

const canvas = renderer.domElement;
const bounds = canvas.getBoundingClientRect();
/** Point and press at a normalized canvas point, y up, through the canvas's own listeners. */
const press = (x: number, y: number) => {
  const init = {
    clientX: bounds.left + ((x + 1) / 2) * bounds.width,
    clientY: bounds.top + ((1 - y) / 2) * bounds.height,
    button: 0,
    bubbles: true,
  };
  canvas.dispatchEvent(new PointerEvent('pointermove', init));
  canvas.dispatchEvent(new PointerEvent('pointerdown', init));
  canvas.dispatchEvent(new PointerEvent('pointerup', init));
};
const space = () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
  window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));
};
/** Run frames until `done`, noting any mesh that was not there when preparation finished. */
const until = async (done: () => boolean, each?: () => void) => {
  do {
    await nextFrame();
    each?.();

    for (const id of meshIds()) {
      if (!preparedMeshes.has(id) && !newMeshes.has(id)) newMeshes.set(id, `${stage}:${beat().beat}`);
    }
  } while (!done());
};
const buttonDrawn = () => beat().beat === 'black' && world.get(PlayButton)!.reveal >= 1;
const now = () => world.get(Time)!.elapsed;
const started = performance.now();

try {
  // The sequence, from a replay to the Play button drawn over the black frame.
  space();
  await until(() => beat().beat === 'closed');
  await until(buttonDrawn);

  // Play: the button, the robot sent about the floor, and rain fed to the little hole until it goes critical and the
  // finale it grows into ends at the button again.
  stage = 'play';
  press(0, 0);
  await until(() => world.get(Mode)!.kind === 'play' && beat().beat === 'closed');
  const spots = [
    [-0.55, -0.45],
    [0.5, 0.35],
    [0.65, -0.5],
    [-0.35, 0.5],
    [0.1, -0.6],
    [-0.7, 0.1],
  ] as const;
  let pressAt = now() + 1.2;
  let spot = 0;
  let feedAt = 0;
  const { holdBody, releaseBody } = actions(world);

  await until(buttonDrawn, () => {
    const hole = beat();

    if (hole.beat !== 'closed' && hole.beat !== 'play') return;

    if (now() >= pressAt) {
      const [x, y] = spots[spot++ % spots.length]!;
      press(x, y);
      pressAt = now() + 1.5;
    }

    // What the player pushes in: a glyph that has come down on the paper, set down again at the hole's edge.
    if (hole.beat !== 'play' || now() < feedAt) return;

    const drop = world.get(Rain)!.drops.find((entry) => entry.phase === 'live' && !entry.entity!.get(Body)!.airborne);

    if (drop === undefined) return;

    holdBody(drop.entity!, { x: hole.x + hole.horizon * 0.5, y: hole.y, z: 0.02, yaw: 0 });
    releaseBody(drop.entity!, [0, 0, 0], 0);
    feedAt = now() + 0.3;
  });

  // A replay after play: the title lifts from wherever play left it and the sequence runs again.
  stage = 'replay';
  space();
  await until(() => world.get(Mode)!.kind === 'sequence' && beat().beat === 'closed');
  await until(buttonDrawn);
} finally {
  stopBefore();
  stopAfter();
  renderPipeline.render = render;
  observer.disconnect();

  for (const { job, callback } of wrapped) job.callback = callback;
}

await Promise.all(pendingFrames);
const lateAssets = performance
  .getEntriesByType('resource')
  .filter((entry) => entry.startTime >= started && /\.(glb|wasm|ttf|woff2?|png|webp)(\?|$)/.test(entry.name))
  .map((entry) => entry.name);
const observed = { late: [...late], meshes: [...newMeshes.values()], assets: lateAssets };
// Negative control: a new shader must be seen by the same counters used to claim zero late compilation.
const control = new Scene();
const geometry = new PlaneGeometry(1, 1);
const material = new MeshBasicNodeMaterial();
material.fragmentNode = vec4(0.12345, 0.54321, 0.98765, 1);
control.add(new Mesh(geometry, material));

try {
  await renderer.compileAsync(control, camera);

  if (late.length <= observed.late.length) throw new Error('Compilation monitoring missed the negative control');
} finally {
  backend.createProgram = program;
  backend.createRenderPipeline = pipeline;
  geometry.dispose();
  material.dispose();
}

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);

  return Math.round((sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0) * 100) / 100;
}

const round = (value: number) => Math.round(value * 100) / 100;
const intervals = samples.map((sample, index) => (index === 0 ? 0 : sample.at - samples[index - 1]!.at));

if (samples.length < 2) throw new Error('No rendered frames were measured');

/**
 * A hitch is a frame that arrived more than two 60 Hz frames after the last, or one whose CPU or GPU work alone
 * overran a frame. Headless Chromium paces rAF at 120 Hz, so an interval of 25 ms is the limiter, not a hitch.
 */
const hitches = samples
  .map((sample, index) => ({ sample, interval: intervals[index]! }))
  .filter(
    ({ sample, interval }, index) => index > 0 && (interval > 34 || sample.cpuMs > 16.7 || (sample.gpuMs ?? 0) > 16.7),
  )
  .map(({ sample, interval }) => ({
    stage: sample.stage,
    mode: sample.mode,
    beat: sample.beat,
    time: round(sample.time),
    interval: round(interval),
    cpu: round(sample.cpuMs),
    gpu: round(sample.gpuMs ?? 0),
    jobs: Object.fromEntries(
      Object.entries(sample.jobs)
        .filter(([, ms]) => ms >= 0.5)
        .map(([id, ms]) => [id, round(ms)]),
    ),
  }));
const stages = [...new Set(samples.map((sample) => sample.stage))].map((name) => {
  const frames = samples
    .map((sample, index) => ({ sample, interval: intervals[index]! }))
    .filter((entry) => entry.sample.stage === name);
  const steady = frames.slice(1);
  const jobIds = [...new Set(frames.flatMap(({ sample }) => Object.keys(sample.jobs)))];

  return {
    stage: name,
    frames: frames.length,
    seconds: round((frames.at(-1)!.sample.at - frames[0]!.sample.at) / 1000),
    intervalP50: percentile(
      steady.map((entry) => entry.interval),
      0.5,
    ),
    intervalP99: percentile(
      steady.map((entry) => entry.interval),
      0.99,
    ),
    worstInterval: round(Math.max(...steady.map((entry) => entry.interval))),
    over34: steady.filter((entry) => entry.interval > 34).length,
    cpuP50: percentile(
      frames.map(({ sample }) => sample.cpuMs),
      0.5,
    ),
    cpuP95: percentile(
      frames.map(({ sample }) => sample.cpuMs),
      0.95,
    ),
    cpuMax: round(Math.max(...frames.map(({ sample }) => sample.cpuMs))),
    gpuP50: percentile(
      frames.map(({ sample }) => sample.gpuMs ?? 0),
      0.5,
    ),
    gpuP95: percentile(
      frames.map(({ sample }) => sample.gpuMs ?? 0),
      0.95,
    ),
    gpuMax: round(Math.max(...frames.map(({ sample }) => sample.gpuMs ?? 0))),
    drawCallsMax: Math.max(...frames.map(({ sample }) => sample.drawCalls ?? 0)),
    /** Each job's CPU milliseconds in this stage: median, 95th percentile, and worst. */
    jobs: Object.fromEntries(
      jobIds.map((id) => {
        const times = frames.map(({ sample }) => sample.jobs[id] ?? 0);

        return [id, [percentile(times, 0.5), percentile(times, 0.95), round(Math.max(...times))]];
      }),
    ),
  };
});
// Chrome's own reading of the heap, sampled a frame at a time: every rise is what the frame allocated, and the
// falls are collections. Quantized and coarse, but enough to weigh the allocation rate against a collection.
const heap = (performance as { memory?: { usedJSHeapSize: number } }).memory;
const allocated = heapSamples.reduce(
  (sum, value, index) => sum + Math.max(0, value - (heapSamples[index - 1] ?? value)),
  0,
);
const collections = heapSamples.reduce(
  (count, value, index) => count + (value < (heapSamples[index - 1] ?? value) ? 1 : 0),
  0,
);

console.log(
  'hero-performance',
  JSON.stringify({
    backend: 'webgpu',
    adapter: {
      vendor: backend.device.adapterInfo.vendor,
      architecture: backend.device.adapterInfo.architecture,
      device: backend.device.adapterInfo.device,
      description: backend.device.adapterInfo.description,
    },
    userAgent: navigator.userAgent,
    viewport: [innerWidth, innerHeight],
    drawingBuffer: [renderer.domElement.width, renderer.domElement.height],
    preparationMs: round(started),
    /** When each preparation phase began, from the page's own marks. */
    phases: performance
      .getEntriesByType('mark')
      .filter((mark) => mark.name.startsWith('hero-'))
      .map((mark) => [mark.name.slice(5), Math.round(mark.startTime)]),
    observed,
    stages,
    heapKbPerFrame: heap === undefined ? null : Math.round(allocated / Math.max(1, heapSamples.length) / 1024),
    heapCollections: collections,
    longTasks: longTasks.map((task) => ({ ...task, at: round(task.at), duration: round(task.duration) })),
    hitches,
  }),
);

if (observed.late.length || observed.meshes.length || observed.assets.length) {
  throw new Error(`Late hero work: ${JSON.stringify(observed)}`);
}
