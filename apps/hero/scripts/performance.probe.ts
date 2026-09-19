/* @workflow {
  "name": "hero:performance",
  "summary": "Run two complete hero replays and reject late shader compilation, mesh creation, or asset loads after preparation.",
  "requirements": "Workspace dependencies, baked hero assets, and GPU-enabled Chromium through Vitexec.",
  "writes": "Raw frame timings, long tasks, resource counts, and environment details to stdout",
  "args": ["--gpu", "--timeout", "180"]
} */
import { _roots, getScheduler } from '@react-three/fiber/webgpu';
import { vec4 } from 'three/tsl';
import { Mesh, MeshBasicNodeMaterial, PlaneGeometry, Scene, WebGPUBackend, WebGPURenderer } from 'three/webgpu';
import type { HoleState } from '../src/black-hole/traits';

const { BURST_SECONDS } = (await import(
  new URL('/src/black-hole/utils.ts', location.origin).href
)) as typeof import('../src/black-hole/utils');
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

const hole = (globalThis as { heroHole?: { state(): HoleState } }).heroHole;

if (hole === undefined) throw new Error('Missing hero timeline');

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
const latePrograms: number[] = [];
const latePipelines: number[] = [];

backend.createProgram = function (...args) {
  latePrograms.push(performance.now());
  program.apply(this, args);
};

backend.createRenderPipeline = function (...args) {
  latePipelines.push(performance.now());
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
const newMeshes = new Set<number>();
const samples: { at: number; cpuMs: number; cycle: number; beat: string; time: number; gpuDoneMs?: number }[] = [];
const pendingFrames = new Set<Promise<void>>();
let maxPendingFrames = 0;
const longTasks: { at: number; duration: number }[] = [];

const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) longTasks.push({ at: entry.startTime, duration: entry.duration });
});

observer.observe({ type: 'longtask' });
let frameStart = 0;
let cycle = 0;
const scheduler = getScheduler();

const stopBefore = scheduler.registerGlobal('before', 'hero-profile-start', () => {
  frameStart = performance.now();
});

const render = renderPipeline.render;

renderPipeline.render = function () {
  const at = performance.now();
  render.call(this);
  const beat = hole.state();
  const sample: (typeof samples)[number] = {
    at,
    cpuMs: performance.now() - frameStart,
    cycle,
    beat: beat.beat,
    time: beat.time,
  };
  samples.push(sample);

  // Observe completion without serializing playback. This detects queued GPU work that submission FPS hides.
  const completion = backend.device.queue.onSubmittedWorkDone().then(() => {
    sample.gpuDoneMs = performance.now() - at;
    pendingFrames.delete(completion);
  });

  pendingFrames.add(completion);
  maxPendingFrames = Math.max(maxPendingFrames, pendingFrames.size);
};

const started = performance.now();

try {
  for (cycle = 0; cycle < 2; cycle++) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));

    do {
      await nextFrame();

      for (const id of meshIds()) if (!preparedMeshes.has(id)) newMeshes.add(id);
    } while ((hole.state().sincePop ?? -1) < BURST_SECONDS);
  }
} finally {
  stopBefore();
  renderPipeline.render = render;
  observer.disconnect();
}

await Promise.all(pendingFrames);
const lateAssets = performance
  .getEntriesByType('resource')
  .filter((entry) => entry.startTime >= started && /\.(glb|wasm|ttf|woff2?|png|webp)(\?|$)/.test(entry.name))
  .map((entry) => entry.name);
const observed = {
  programs: latePrograms.length,
  pipelines: latePipelines.length,
  meshes: newMeshes.size,
  assets: lateAssets,
};
// Negative control: a new shader must be seen by the same counters used to claim zero late compilation.
const control = new Scene();
const geometry = new PlaneGeometry(1, 1);
const material = new MeshBasicNodeMaterial();
material.fragmentNode = vec4(0.12345, 0.54321, 0.98765, 1);
control.add(new Mesh(geometry, material));

try {
  await renderer.compileAsync(control, camera);

  if (latePrograms.length <= observed.programs || latePipelines.length <= observed.pipelines)
    throw new Error('Compilation monitoring missed the negative control');
} finally {
  backend.createProgram = program;
  backend.createRenderPipeline = pipeline;
  geometry.dispose();
  material.dispose();
}

const intervals = samples.slice(1).map((sample, index) => sample.at - samples[index]!.at);

if (intervals.length === 0) throw new Error('No rendered frames were measured');

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor((sorted.length - 1) * fraction)];
}

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
    preparationMs: started,
    observed,
    frames: samples.length,
    fps: (intervals.length * 1000) / intervals.reduce((sum, value) => sum + value, 0),
    intervalP50: percentile(intervals, 0.5),
    intervalP95: percentile(intervals, 0.95),
    intervalP99: percentile(intervals, 0.99),
    worstInterval: Math.max(...intervals),
    intervalsOver25: intervals.filter((value) => value > 25).length,
    cpuP95: percentile(
      samples.map((sample) => sample.cpuMs),
      0.95,
    ),
    // Browser-observed queue completion latency, not a GPU timestamp measurement.
    gpuCompletionP95: percentile(
      samples.map((sample) => sample.gpuDoneMs!),
      0.95,
    ),
    maxPendingFrames,
    longTasks,
    samples,
  }),
);

if (observed.programs || observed.pipelines || observed.meshes || observed.assets.length) {
  throw new Error(`Late hero work: ${JSON.stringify(observed)}`);
}
