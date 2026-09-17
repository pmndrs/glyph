export {};

const catalogPath = '/src/workloads/catalog.ts';
const workloadCatalog: typeof import('../src/workloads/catalog') = await import(/* @vite-ignore */ catalogPath);
const { BENCHMARK_WORKLOADS } = workloadCatalog;
const frameTimeModulePath = '/src/benchmark/frame-time.ts';
const { sampleAnimationPerformance }: typeof import('../src/benchmark/frame-time') = await import(
  /* @vite-ignore */ frameTimeModulePath
);
const telemetryModulePath = '/src/renderer/live-frame-telemetry.ts';
const { requestLiveFrameTelemetryCapture }: typeof import('../src/renderer/live-frame-telemetry') = await import(
  /* @vite-ignore */ telemetryModulePath
);
type BenchmarkWorkloadId = keyof typeof BENCHMARK_WORKLOADS;
type DurationSummary = import('../src/benchmark/frame-time').DurationSummary;
type FrameTimeSummary = import('../src/benchmark/frame-time').FrameTimeSummary;

const rasterFormats = [
  { id: 'bitmap', label: 'Bitmap' },
  { id: 'mtsdf', label: 'MSDF' },
  { id: 'slug', label: 'Slug' },
] as const;
const workloads = Object.values(BENCHMARK_WORKLOADS).map(({ id, label }) => ({ id, label }));
const comparisonWorkloads = new Set<BenchmarkWorkloadId>(
  Object.values(BENCHMARK_WORKLOADS)
    .filter(({ surface }) => surface === 'comparison')
    .map(({ id }) => id),
);

type RasterFormatName = (typeof rasterFormats)[number]['id'];

function presentationState(): string {
  const viewport = document.querySelector<HTMLElement>('[data-testid$="live-viewport"]');
  return JSON.stringify({
    attributes:
      viewport === null
        ? undefined
        : Object.fromEntries([...viewport.attributes].map(({ name, value }) => [name, value])),
    buttons: [...document.querySelectorAll<HTMLButtonElement>('button')].map((button) => ({
      ariaLabel: button.getAttribute('aria-label'),
      text: button.textContent?.trim(),
    })),
    url: location.href,
  });
}

function visible<T extends HTMLElement>(elements: NodeListOf<T> | T[]): T | undefined {
  return [...elements].find((element) => element.offsetParent !== null);
}

function waitFor<T>(find: () => T | undefined, timeoutMs = 20_000): Promise<T> {
  const current = find();
  if (current !== undefined) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timed out waiting for benchmark state: ${presentationState()}`));
    }, timeoutMs);
    const observer = new MutationObserver(() => {
      const value = find();
      if (value === undefined) return;
      clearTimeout(timeout);
      observer.disconnect();
      resolve(value);
    });
    observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true });
  });
}

async function selectFormat(id: RasterFormatName, label: string): Promise<void> {
  if (new URLSearchParams(location.search).get('technique') === id) return;
  const button = visible(
    [...document.querySelectorAll<HTMLButtonElement>('button')].filter(
      (candidate) => candidate.textContent?.trim() === label,
    ),
  );
  if (button === undefined) throw new Error(`Missing ${label} raster-format button`);
  button.click();
  await waitFor(() => (new URLSearchParams(location.search).get('technique') === id ? true : undefined));
}

async function selectWorkload(id: BenchmarkWorkloadId, label: string): Promise<void> {
  if (new URLSearchParams(location.search).get('workload') === id) return;
  const trigger = visible(document.querySelectorAll<HTMLButtonElement>('button[aria-label="Live workload"]'));
  if (trigger === undefined) throw new Error('Missing Presentation workload control');
  trigger.click();
  const listbox = await waitFor(() => visible(document.querySelectorAll<HTMLElement>('[role="listbox"]')));
  const option = [...listbox.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (option === undefined) throw new Error(`Missing ${label} workload option`);
  option.click();
  await waitFor(() => (new URLSearchParams(location.search).get('workload') === id ? true : undefined));
}

async function readyViewport(format: RasterFormatName, workload: BenchmarkWorkloadId): Promise<HTMLElement> {
  const selector = comparisonWorkloads.has(workload)
    ? `[data-testid="comparison-live-viewport"][data-technique="${format}"][data-workload="${workload}"]`
    : `[data-testid="${format}-live-viewport"]`;
  return waitFor(() => {
    const viewport = visible(document.querySelectorAll<HTMLElement>(selector));
    const framesPerSecond = Number(viewport?.getAttribute('data-frames-per-second'));
    if (
      viewport === undefined ||
      viewport.getAttribute('data-workload') !== workload ||
      viewport.getAttribute('data-presentation-pending') !== 'false' ||
      !Number.isFinite(framesPerSecond) ||
      framesPerSecond <= 0 ||
      Number(viewport.getAttribute('data-glyph-count')) <= 0 ||
      Number(viewport.getAttribute('data-draw-count')) <= 0 ||
      viewport.getAttribute('data-missing-glyph-count') !== '0'
    ) {
      return undefined;
    }
    return viewport;
  }, 60_000);
}

const results: Array<{
  readonly draws: number;
  readonly cpuTime: DurationSummary;
  readonly frameTime: FrameTimeSummary;
  readonly glyphs: number;
  readonly technique: RasterFormatName;
  readonly workload: BenchmarkWorkloadId;
}> = [];
for (const format of rasterFormats) {
  await selectFormat(format.id, format.label);
  for (const workload of workloads) {
    await selectWorkload(workload.id, workload.label);
    const viewport = await readyViewport(format.id, workload.id);
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-configured-renderer-active="true"]');
    if (canvas === null) throw new Error('Presentation performance sample lost its renderer canvas');
    const { cpuTime, summary: frameTime } = await sampleAnimationPerformance(window, async (sampleFrames) => {
      const capture = await requestLiveFrameTelemetryCapture(canvas, {
        cpuSampleCount: sampleFrames,
        gpuSampleCount: 0,
        signal: AbortSignal.timeout(60_000),
      });
      return capture.cpuMs;
    });
    const record = {
      technique: format.id,
      workload: workload.id,
      cpuTime,
      frameTime,
      glyphs: Number(viewport.getAttribute('data-glyph-count')),
      draws: Number(viewport.getAttribute('data-draw-count')),
    };
    results.push(record);
    console.log('presentation-fps-cell', JSON.stringify(record));
  }
}
console.log('presentation-fps-sweep-ready', JSON.stringify(results));
/* @workflow { "name": "benchmark:presentation-performance", "summary": "Measure fixed-window Presentation frame times on hardware WebGPU.", "requirements": "GPU-enabled Chromium and Vitexec.", "writes": "Standard output only.", "args": ["--gpu", "--path", "/presentation?technique=bitmap&backend=webgpu&delivery=baked&dpr=2&font=inter&workload=benchmark-ipsum"] } */
