/* @workflow { "name": "benchmark:presentation-fresh-scene-performance", "summary": "Measure selected Presentation workloads in independent scene-local telemetry windows.", "requirements": "GPU-enabled Chromium and authenticated benchmark fixtures.", "writes": "Standard output only.", "args": ["--gpu", "--path", "/?rounds=7", "--timeout", "300"] } */

import type { ComparisonWorkloadId } from '../src/workloads/comparison/contracts';

export {};

const telemetryModulePath = '/src/renderer/live-frame-telemetry.ts';
const telemetryModule: typeof import('../src/renderer/live-frame-telemetry') = await import(
  /* @vite-ignore */ telemetryModulePath
);

const allWorkloads = [
  'off-axis-3d',
  'dynamic-layout',
  'paint-effects',
  'icon-grid',
  'billboard-labels',
  'rich-text',
  'paragraph-stress',
  'editorial',
] as const satisfies readonly ComparisonWorkloadId[];

type FreshSceneWorkload = (typeof allWorkloads)[number];

interface FreshSceneSample {
  readonly cpuMs: number;
  readonly draws: number;
  readonly frames: number;
  readonly glyphs: number;
  readonly gpuFrames: number;
  readonly gpuMs: number;
  readonly round: number;
  readonly workload: FreshSceneWorkload;
}

interface FreshSceneTimingSummary {
  readonly maxMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
}

interface FreshSceneWindow {
  readonly cpuMaxMs: number;
  readonly cpuMs: readonly number[];
  readonly cpuP50Ms: number;
  readonly cpuP95Ms: number;
  readonly gpuMaxMs: number;
  readonly gpuMs: readonly number[];
  readonly gpuP50Ms: number;
  readonly gpuP95Ms: number;
  readonly round: number;
  readonly workload: FreshSceneWorkload;
}

const parameters = new URL(location.href).searchParams;
const workloadParameter = parameters.get('workload');
if (workloadParameter !== null && !isFreshSceneWorkload(workloadParameter)) {
  throw new RangeError(`unknown fresh-scene workload: ${workloadParameter}`);
}
const workloads: readonly FreshSceneWorkload[] = workloadParameter === null ? allWorkloads : [workloadParameter];
const roundsParameter = Number(parameters.get('rounds') ?? '7');
if (!Number.isSafeInteger(roundsParameter) || roundsParameter <= 0 || roundsParameter > 20) {
  throw new RangeError('fresh-scene rounds must be an integer in [1, 20]');
}

function isFreshSceneWorkload(value: string): value is FreshSceneWorkload {
  return allWorkloads.some((workload) => workload === value);
}

if (window.top !== window.self) await new Promise<never>(() => {});

const samples: FreshSceneSample[] = [];
for (let round = 0; round < roundsParameter; round += 1) {
  for (let offset = 0; offset < workloads.length; offset += 1) {
    const workload = workloads[(round + offset) % workloads.length]!;
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0';
    iframe.src = `/presentation?mode=benchmark&technique=bitmap&backend=webgpu&delivery=baked&dpr=2&font=inter&workload=${workload}`;
    document.body.append(iframe);
    try {
      const viewport = await waitFor(() => {
        const candidate = iframe.contentDocument?.querySelector<HTMLElement>(
          `[data-testid="comparison-live-viewport"][data-technique="bitmap"][data-workload="${workload}"]`,
        );
        if (candidate === null || candidate === undefined || candidate.offsetParent === null) return undefined;
        if (candidate.dataset.presentationPending !== 'false') return undefined;
        if (!(Number(candidate.dataset.framesPerSecond) > 0) || !(Number(candidate.dataset.drawCount) > 0)) {
          return undefined;
        }
        if (candidate.dataset.missingGlyphCount !== '0') return undefined;
        return candidate;
      });
      const child = iframe.contentWindow;
      if (child === null) throw new Error('fresh-scene iframe lost its window');
      await waitFrames(child, 30);
      const canvas = viewport.parentElement?.querySelector('canvas');
      if (canvas === null || canvas === undefined) throw new Error('fresh-scene viewport lost its renderer canvas');
      const capture = await telemetryModule.requestLiveFrameTelemetryCapture(canvas, {
        cpuSampleCount: 120,
        gpuSampleCount: 120,
        signal: AbortSignal.timeout(60_000),
      });
      const cpu = nearestRankTimingSummary(capture.cpuMs);
      const gpu = nearestRankTimingSummary(capture.gpuMs);
      const evidence = {
        round,
        workload,
        cpuMs: [...capture.cpuMs],
        gpuMs: [...capture.gpuMs],
        cpuP50Ms: cpu.p50Ms,
        cpuP95Ms: cpu.p95Ms,
        cpuMaxMs: cpu.maxMs,
        gpuP50Ms: gpu.p50Ms,
        gpuP95Ms: gpu.p95Ms,
        gpuMaxMs: gpu.maxMs,
      } satisfies FreshSceneWindow;
      const sample = {
        round,
        workload,
        cpuMs: evidence.cpuP50Ms,
        gpuMs: evidence.gpuP50Ms,
        frames: capture.cpuMs.length,
        gpuFrames: capture.gpuMs.length,
        draws: Number(viewport.dataset.drawCount),
        glyphs: Number(viewport.dataset.glyphCount),
      } satisfies FreshSceneSample;
      samples.push(sample);
      console.log('fresh-scene-window', JSON.stringify(evidence));
      console.log('fresh-scene-cell', JSON.stringify(sample));
    } finally {
      iframe.remove();
    }
    await waitFrames(window, 2);
  }
}

console.log('fresh-scene-summary', JSON.stringify({ rounds: roundsParameter, samples }));
console.log('fresh-scene-ready');

function waitFor<Value>(read: () => Value | undefined, timeoutMs = 60_000): Promise<Value> {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = (): void => {
      const value = read();
      if (value !== undefined) resolve(value);
      else if (performance.now() - started >= timeoutMs) reject(new Error('fresh scene timed out'));
      else requestAnimationFrame(poll);
    };
    poll();
  });
}

function waitFrames(target: Window, count: number): Promise<void> {
  return new Promise((resolve) => {
    const next = (): void => {
      count -= 1;
      if (count === 0) resolve();
      else target.requestAnimationFrame(next);
    };
    target.requestAnimationFrame(next);
  });
}

function nearestRankTimingSummary(timings: Float64Array): FreshSceneTimingSummary {
  if (timings.length === 0) throw new RangeError('fresh-scene capture requires a nonempty timing window');
  const sorted = timings.slice().sort();
  if (sorted.some((timing) => !Number.isFinite(timing))) {
    throw new RangeError('fresh-scene capture produced a non-finite timing');
  }
  return {
    maxMs: sorted[sorted.length - 1]!,
    p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1]!,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
  };
}
