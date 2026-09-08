/* @workflow {
  "name": "benchmark:icon-grid-soak",
  "summary": "Profile a long retained Icon Grid soak in an isolated GPU Chromium session.",
  "requirements": "Manual-only GPU-enabled Chromium run with built runtime packages and authenticated benchmark fixtures; never run in CI.",
  "writes": "CPU, heap, trace, screenshot, and JSON evidence under apps/benchmarks/.cache/icon-grid-soak or --output."
} */

import { mkdir, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, CDPSession, Page } from 'playwright';
import { createServer } from 'vite';

import { LOOPBACK_HOST, selectLoopbackPort } from './support/loopback-port.mts';
import { launchProjectChromium } from './support/project-chromium.mts';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const durationMs = integerOption('--duration-ms', 300_000, 10_000, 1_800_000);
const samplePeriodMs = integerOption('--sample-period-ms', 1_000, 250, 10_000);
const outputDirectory = resolvePath(
  root,
  stringOption('--output') ??
    `.cache/icon-grid-soak/${new Date().toISOString().replaceAll(':', '-')}-${String(process.pid)}`,
);
await mkdir(outputDirectory, { recursive: true });

const consoleProblems: string[] = [];
const server = await createServer({ root, server: { host: LOOPBACK_HOST, port: await selectLoopbackPort() } });
await server.listen();
const address = server.httpServer?.address();
if (address === null || address === undefined || typeof address === 'string') {
  await server.close();
  throw new Error('Vite did not publish a local TCP address');
}

let browser: Browser | undefined;
let cdp: CDPSession | undefined;
let profilerStarted = false;
let heapSamplingStarted = false;
let tracingStarted = false;
let maxTraceBufferUsage = 0;
const traceCapture = createTraceCapture(64 * 1_048_576);
try {
  browser = await launchProjectChromium({
    headless: true,
    args: ['--enable-gpu', '--enable-precise-memory-info', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { height: 720, width: 1_280 } });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => consoleProblems.push(`pageerror: ${error.message}`));
  page.on('crash', () => consoleProblems.push('page crash'));

  cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable', { timeDomain: 'timeTicks' });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 1_000 });
  await cdp.send('HeapProfiler.enable');

  await page.goto(
    `http://${LOOPBACK_HOST}:${String(address.port)}/presentation?mode=benchmark&technique=bitmap&backend=webgpu&delivery=baked&dpr=2&font=inter&workload=icon-grid`,
    { waitUntil: 'domcontentloaded' },
  );
  await waitForIconGrid(page);
  const gpuAdapter = await readGpuAdapter(page);
  const wasmMemoryPrototype = await cdp.send('Runtime.evaluate', {
    expression: 'WebAssembly.Memory.prototype',
    objectGroup: 'icon-grid-soak',
  });
  const wasmMemoryPrototypeObjectId = wasmMemoryPrototype.result.objectId;
  if (wasmMemoryPrototypeObjectId === undefined) throw new Error('Chrome did not expose WebAssembly.Memory.prototype');
  const wasmMemoryObjects = await cdp.send('Runtime.queryObjects', {
    objectGroup: 'icon-grid-soak',
    prototypeObjectId: wasmMemoryPrototypeObjectId,
  });
  const wasmMemoryObjectsObjectId = wasmMemoryObjects.objects.objectId;
  if (wasmMemoryObjectsObjectId === undefined) throw new Error('Chrome did not return live WebAssembly.Memory objects');

  await cdp.send('HeapProfiler.startSampling', {
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
    samplingInterval: 32_768,
  });
  heapSamplingStarted = true;
  await cdp.send('Profiler.start');
  profilerStarted = true;
  cdp.on('Tracing.bufferUsage', ({ percentFull, value }) => {
    maxTraceBufferUsage = Math.max(maxTraceBufferUsage, percentFull ?? value ?? 0);
  });
  cdp.on('Tracing.dataCollected', ({ value }) => traceCapture.add(value));
  await cdp.send('Tracing.start', {
    bufferUsageReportingInterval: 1_000,
    categories: 'devtools.timeline',
    options: 'record-continuously',
    transferMode: 'ReportEvents',
  });
  tracingStarted = true;
  await installSoakObserver(page);

  const samples: SoakSample[] = [];
  const startedAt = Date.now();
  while (Date.now() - startedAt < durationMs) {
    await delay(Math.min(samplePeriodMs, durationMs - (Date.now() - startedAt)));
    const [browserSample, performanceResult, heapUsage, wasmMemory] = await Promise.all([
      page.evaluate(readBrowserSample),
      cdp.send('Performance.getMetrics'),
      cdp.send('Runtime.getHeapUsage'),
      readWasmMemory(cdp, wasmMemoryObjectsObjectId),
    ]);
    samples.push({
      ...browserSample,
      elapsedMs: Date.now() - startedAt,
      heap: heapUsage,
      performance: Object.fromEntries(performanceResult.metrics.map(({ name, value }) => [name, value])),
      wasmMemory,
    });
    if (samples.length % Math.max(1, Math.round(30_000 / samplePeriodMs)) === 0) {
      const latest = samples.at(-1)!;
      process.stderr.write(
        `[icon-grid-soak] ${String(Math.round(latest.elapsedMs / 1_000))}s ` +
          `max-frame=${latest.observer.maxFrameDeltaMs.toFixed(2)}ms ` +
          `heap=${String(Math.round(latest.heap.usedSize / 1_048_576))}MiB ` +
          `timer-pending=${String(latest.timer.pendingCount)}\n`,
      );
    }
  }

  const finalBrowserSample = await page.evaluate(readBrowserSample);
  if (finalBrowserSample.sceneError !== undefined)
    consoleProblems.push(`scene-error: ${finalBrowserSample.sceneError}`);
  const preGcHeap = await cdp.send('Runtime.getHeapUsage');
  const preGcWasmMemory = await readWasmMemory(cdp, wasmMemoryObjectsObjectId);
  const cpuProfile = await cdp.send('Profiler.stop');
  profilerStarted = false;
  const heapProfile = await cdp.send('HeapProfiler.stopSampling');
  heapSamplingStarted = false;
  await page.screenshot({ path: resolvePath(outputDirectory, 'icon-grid-final.png') });
  const trace = await stopTracing(cdp);
  tracingStarted = false;
  await cdp.send('HeapProfiler.collectGarbage');
  const postGcHeap = await cdp.send('Runtime.getHeapUsage');
  const postGcWasmMemory = await readWasmMemory(cdp, wasmMemoryObjectsObjectId);

  await Promise.all([
    writeFile(resolvePath(outputDirectory, 'cpu-profile.json'), JSON.stringify(cpuProfile.profile)),
    writeFile(resolvePath(outputDirectory, 'heap-sampling-profile.json'), JSON.stringify(heapProfile.profile)),
    writeFile(resolvePath(outputDirectory, 'performance-trace.json'), traceCapture.document()),
  ]);
  const evidence = {
    browserVersion: browser.version(),
    consoleProblems,
    cpuHotspots: summarizeCpuProfile(cpuProfile.profile),
    durationMs,
    environment: {
      architecture: arch(),
      cpu: cpus()[0]?.model,
      logicalCpuCount: cpus().length,
      node: process.version,
      platform: platform(),
      release: release(),
      totalMemoryBytes: totalmem(),
    },
    final: finalBrowserSample,
    gpuAdapter,
    heapHotspots: summarizeHeapProfile(heapProfile.profile),
    postGcHeap,
    postGcWasmMemory,
    preGcHeap,
    preGcWasmMemory,
    samplePeriodMs,
    samples,
    summary: summarize(samples, finalBrowserSample),
    trace: {
      ...traceCapture.summary(),
      dataLossOccurred: trace.dataLossOccurred,
      maxBufferUsage: maxTraceBufferUsage,
    },
    url: page.url(),
    wasmMemoryScope: 'WebAssembly.Memory objects live after Icon Grid readiness',
  };
  await writeFile(resolvePath(outputDirectory, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`icon-grid-soak-evidence ${JSON.stringify({ outputDirectory, ...evidence.summary })}\n`);
  if (consoleProblems.length !== 0) {
    throw new Error(`Icon Grid emitted browser warnings or errors: ${consoleProblems.join(' | ')}`);
  }
} finally {
  if (cdp !== undefined) {
    if (profilerStarted) await cdp.send('Profiler.stop').catch(() => undefined);
    if (heapSamplingStarted) await cdp.send('HeapProfiler.stopSampling').catch(() => undefined);
    if (tracingStarted) await cdp.send('Tracing.end').catch(() => undefined);
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'icon-grid-soak' }).catch(() => undefined);
  }
  await browser?.close();
  await server.close();
}

interface SoakObserverSnapshot {
  readonly frameCount: number;
  readonly framesOver100Ms: number;
  readonly framesOver1s: number;
  readonly framesOver50Ms: number;
  readonly framesOver5s: number;
  readonly longFrames: readonly { readonly atMs: number; readonly deltaMs: number; readonly recycleCount: number }[];
  readonly longTasks: readonly { readonly durationMs: number; readonly startMs: number }[];
  readonly maxFrameDeltaMs: number;
  readonly measureEntryCount: number;
  readonly measures: Readonly<
    Record<string, { readonly count: number; readonly maxMs: number; readonly totalMs: number }>
  >;
}

interface BrowserSample {
  readonly dataset: Readonly<Record<string, string>>;
  readonly jsMemory:
    | { readonly jsHeapSizeLimit: number; readonly totalJSHeapSize: number; readonly usedJSHeapSize: number }
    | undefined;
  readonly measureEntryCount: number;
  readonly observer: SoakObserverSnapshot;
  readonly sceneError: string | undefined;
  readonly timer: {
    readonly activeFrameId: number | undefined;
    readonly latestFrameId: number | undefined;
    readonly oldestPendingFrameId: number | undefined;
    readonly pendingCount: number;
  };
}

interface SoakSample extends BrowserSample {
  readonly elapsedMs: number;
  readonly heap: {
    readonly backingStorageSize: number;
    readonly embedderHeapUsedSize: number;
    readonly totalSize: number;
    readonly usedSize: number;
  };
  readonly performance: Readonly<Record<string, number>>;
  readonly wasmMemory: WasmMemorySample;
}

interface WasmMemorySample {
  readonly byteLengths: readonly number[];
  readonly count: number;
  readonly totalBytes: number;
}

interface GpuAdapterSample {
  readonly architecture: string;
  readonly description: string;
  readonly device: string;
  readonly vendor: string;
}

interface TraceEvent {
  readonly dur?: unknown;
  readonly name?: unknown;
}

interface TraceGcSummary {
  count: number;
  maxDurationMs: number;
  totalDurationMs: number;
}

interface TraceCapture {
  add(events: readonly TraceEvent[]): void;
  document(): string;
  summary(): {
    readonly droppedBytes: number;
    readonly droppedChunkCount: number;
    readonly gc: { readonly major: TraceGcSummary; readonly minor: TraceGcSummary };
    readonly retainedBytes: number;
    readonly retainedEventCount: number;
    readonly totalEventCount: number;
  };
}

interface CpuProfileNode {
  readonly callFrame: { readonly functionName: string; readonly url: string };
  readonly id: number;
}

interface CpuProfile {
  readonly nodes: readonly CpuProfileNode[];
  readonly samples?: readonly number[];
  readonly timeDeltas?: readonly number[];
}

interface HeapProfileNode {
  readonly callFrame: { readonly functionName: string; readonly url: string };
  readonly children: readonly HeapProfileNode[];
  readonly selfSize: number;
}

interface HeapProfile {
  readonly head: HeapProfileNode;
}

interface ProfileHotspot {
  readonly functionName: string;
  readonly total: number;
  readonly url: string;
}

interface BrowserSoakState {
  readonly diagnostics: () => BrowserSample['timer'];
  readonly observer: {
    frameCount: number;
    framesOver100Ms: number;
    framesOver1s: number;
    framesOver50Ms: number;
    framesOver5s: number;
    lastFrameAt: number;
    longFrames: Array<{ atMs: number; deltaMs: number; recycleCount: number }>;
    longTasks: Array<{ durationMs: number; startMs: number }>;
    maxFrameDeltaMs: number;
    measureEntryCount: number;
    measures: Record<string, { count: number; maxMs: number; totalMs: number }>;
    startedAt: number;
  };
}

async function installSoakObserver(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const modulePath = '/src/renderer/gpu-frame-timer.ts';
    const timerModule = (await import(/* @vite-ignore */ modulePath)) as {
      requestGpuFrameTimerDiagnostics(target: EventTarget): BrowserSample['timer'];
    };
    const viewport = document.querySelector<HTMLElement>(
      '[data-testid="comparison-live-viewport"][data-workload="icon-grid"]',
    );
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-configured-renderer-active="true"]');
    if (viewport === null || canvas === null) throw new Error('Icon Grid soak lost its viewport or canvas');
    const startedAt = performance.now();
    const observer: BrowserSoakState['observer'] = {
      frameCount: 0,
      framesOver100Ms: 0,
      framesOver1s: 0,
      framesOver50Ms: 0,
      framesOver5s: 0,
      lastFrameAt: startedAt,
      longFrames: [],
      longTasks: [],
      maxFrameDeltaMs: 0,
      measureEntryCount: 0,
      measures: {},
      startedAt,
    };
    const frame = (timestamp: number): void => {
      const deltaMs = timestamp - observer.lastFrameAt;
      observer.lastFrameAt = timestamp;
      observer.frameCount += 1;
      observer.maxFrameDeltaMs = Math.max(observer.maxFrameDeltaMs, deltaMs);
      if (deltaMs >= 50) {
        observer.framesOver50Ms += 1;
        if (deltaMs >= 100) observer.framesOver100Ms += 1;
        if (deltaMs >= 1_000) observer.framesOver1s += 1;
        if (deltaMs >= 5_000) observer.framesOver5s += 1;
        observer.longFrames.push({
          atMs: timestamp - observer.startedAt,
          deltaMs,
          recycleCount: Number(viewport.dataset.iconRecycleCount ?? '0'),
        });
        if (observer.longFrames.length > 256) observer.longFrames.shift();
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'longtask') {
          observer.longTasks.push({ durationMs: entry.duration, startMs: entry.startTime - observer.startedAt });
          if (observer.longTasks.length > 256) observer.longTasks.shift();
          continue;
        }
        observer.measureEntryCount += 1;
        const aggregate = (observer.measures[entry.name] ??= { count: 0, maxMs: 0, totalMs: 0 });
        aggregate.count += 1;
        aggregate.maxMs = Math.max(aggregate.maxMs, entry.duration);
        aggregate.totalMs += entry.duration;
      }
    }).observe({ entryTypes: ['longtask', 'measure'] });
    const scope = globalThis as typeof globalThis & { iconGridSoakState?: BrowserSoakState };
    scope.iconGridSoakState = {
      diagnostics: () => timerModule.requestGpuFrameTimerDiagnostics(canvas),
      observer,
    };
  });
}

function readBrowserSample(): BrowserSample {
  const scope = globalThis as typeof globalThis & { iconGridSoakState?: BrowserSoakState };
  const state = scope.iconGridSoakState;
  const viewport = document.querySelector<HTMLElement>(
    '[data-testid="comparison-live-viewport"][data-workload="icon-grid"]',
  );
  if (state === undefined) throw new Error('Icon Grid soak state is unavailable');
  const dataset = Object.fromEntries(
    [
      'drawCount',
      'framesPerSecond',
      'glyphCount',
      'gpuHistoryLength',
      'gpuTimingSupported',
      'iconAssignedCount',
      'iconPoolCapacity',
      'iconRecycleCount',
      'iconRenderVisibleCount',
      'iconWindowRevision',
      'medianGpuMs',
      'medianSubmitMs',
      'p95GpuMs',
      'p95SubmitMs',
      'presentationPending',
    ].flatMap((key) => {
      const value = viewport?.dataset[key];
      return value === undefined ? [] : [[key, value] as const];
    }),
  );
  const memory = (
    performance as Performance & {
      memory?: { jsHeapSizeLimit: number; totalJSHeapSize: number; usedJSHeapSize: number };
    }
  ).memory;
  return {
    dataset,
    jsMemory:
      memory === undefined
        ? undefined
        : {
            jsHeapSizeLimit: memory.jsHeapSizeLimit,
            totalJSHeapSize: memory.totalJSHeapSize,
            usedJSHeapSize: memory.usedJSHeapSize,
          },
    measureEntryCount: state.observer.measureEntryCount,
    observer: structuredClone(state.observer),
    sceneError: document.querySelector<HTMLElement>('[data-testid="scene-error"]')?.textContent?.trim(),
    timer: state.diagnostics(),
  };
}

async function waitForIconGrid(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const viewport = document.querySelector<HTMLElement>(
      '[data-testid="comparison-live-viewport"][data-workload="icon-grid"]',
    );
    return (
      viewport?.dataset.presentationPending === 'false' &&
      viewport.dataset.backend === 'webgpu' &&
      Number(viewport.dataset.drawCount) === 2 &&
      Number(viewport.dataset.glyphCount) > 0 &&
      Number(viewport.dataset.framesPerSecond) > 0
    );
  });
}

function summarize(samples: readonly SoakSample[], final: BrowserSample): Record<string, number | undefined> {
  const first = samples[0];
  const last = samples.at(-1);
  return {
    backingStorageGrowthBytes:
      first === undefined || last === undefined
        ? undefined
        : last.heap.backingStorageSize - first.heap.backingStorageSize,
    drawCount: Number(final.dataset.drawCount),
    finalTimerBacklogAgeFrames:
      final.timer.latestFrameId === undefined || final.timer.oldestPendingFrameId === undefined
        ? 0
        : final.timer.latestFrameId - final.timer.oldestPendingFrameId,
    framesOver100Ms: final.observer.framesOver100Ms,
    framesOver1s: final.observer.framesOver1s,
    framesOver50Ms: final.observer.framesOver50Ms,
    framesOver5s: final.observer.framesOver5s,
    glyphCount: Number(final.dataset.glyphCount),
    jsHeapGrowthBytes:
      first?.jsMemory === undefined || last?.jsMemory === undefined
        ? undefined
        : last.jsMemory.usedJSHeapSize - first.jsMemory.usedJSHeapSize,
    maxFrameDeltaMs: final.observer.maxFrameDeltaMs,
    maxP95GpuMs: maximumDataset(samples, 'p95GpuMs'),
    maxP95SubmitMs: maximumDataset(samples, 'p95SubmitMs'),
    maxTimerBacklogAgeFrames: maximum(
      samples.map(({ timer }) =>
        timer.latestFrameId === undefined || timer.oldestPendingFrameId === undefined
          ? 0
          : timer.latestFrameId - timer.oldestPendingFrameId,
      ),
    ),
    maxTimerPendingCount: maximum(samples.map(({ timer }) => timer.pendingCount)),
    medianGpuMs: datasetNumber(final, 'medianGpuMs'),
    medianSubmitMs: datasetNumber(final, 'medianSubmitMs'),
    p95GpuMs: datasetNumber(final, 'p95GpuMs'),
    p95SubmitMs: datasetNumber(final, 'p95SubmitMs'),
    recycleCount: Number(final.dataset.iconRecycleCount),
    sampleCount: samples.length,
    wasmMemoryGrowthBytes:
      first === undefined || last === undefined ? undefined : last.wasmMemory.totalBytes - first.wasmMemory.totalBytes,
    wasmMemoryMaxBytes: maximum(samples.map(({ wasmMemory }) => wasmMemory.totalBytes)),
  };
}

async function readWasmMemory(session: CDPSession, objectsObjectId: string): Promise<WasmMemorySample> {
  const result = await session.send('Runtime.callFunctionOn', {
    functionDeclaration:
      'function () { const byteLengths = Array.from(this, (memory) => memory.buffer.byteLength); return { byteLengths, count: byteLengths.length, totalBytes: byteLengths.reduce((sum, bytes) => sum + bytes, 0) }; }',
    objectId: objectsObjectId,
    returnByValue: true,
  });
  return wasmMemorySample(result.result.value);
}

async function readGpuAdapter(page: Page): Promise<GpuAdapterSample> {
  const adapter = await page.evaluate(async () => {
    const value = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
    if (value === null || value === undefined) return undefined;
    const { architecture, description, device, vendor } = value.info;
    return { architecture, description, device, vendor };
  });
  if (adapter === undefined) throw new Error('Chrome did not expose a WebGPU adapter');
  return adapter;
}

function wasmMemorySample(value: unknown): WasmMemorySample {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Chrome returned an invalid WebAssembly.Memory report');
  }
  const { byteLengths, count, totalBytes } = value as Partial<WasmMemorySample>;
  if (
    !Array.isArray(byteLengths) ||
    !byteLengths.every((length) => Number.isSafeInteger(length) && length >= 0) ||
    typeof count !== 'number' ||
    !Number.isSafeInteger(count) ||
    count !== byteLengths.length ||
    typeof totalBytes !== 'number' ||
    !Number.isSafeInteger(totalBytes) ||
    totalBytes !== byteLengths.reduce((sum, length) => sum + length, 0)
  ) {
    throw new TypeError('Chrome returned an invalid WebAssembly.Memory report');
  }
  return { byteLengths, count, totalBytes };
}

function summarizeCpuProfile(profile: CpuProfile): readonly ProfileHotspot[] {
  const samples = profile.samples ?? [];
  const timeDeltas = profile.timeDeltas ?? [];
  const nodes = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
  const totals = new Map<string, ProfileHotspot>();
  for (let index = 0; index < samples.length; index += 1) {
    const callFrame = nodes.get(samples[index]!);
    if (callFrame === undefined) continue;
    const key = `${callFrame.functionName}\u0000${callFrame.url}`;
    const existing = totals.get(key);
    totals.set(key, {
      functionName: callFrame.functionName,
      total: (existing?.total ?? 0) + (timeDeltas[index] ?? 0),
      url: callFrame.url,
    });
  }
  return [...totals.values()].sort((left, right) => right.total - left.total).slice(0, 25);
}

function summarizeHeapProfile(profile: HeapProfile): readonly ProfileHotspot[] {
  const totals = new Map<string, ProfileHotspot>();
  const visit = (node: HeapProfileNode): void => {
    const key = `${node.callFrame.functionName}\u0000${node.callFrame.url}`;
    const existing = totals.get(key);
    totals.set(key, {
      functionName: node.callFrame.functionName,
      total: (existing?.total ?? 0) + node.selfSize,
      url: node.callFrame.url,
    });
    for (const child of node.children) visit(child);
  };
  visit(profile.head);
  return [...totals.values()].sort((left, right) => right.total - left.total).slice(0, 25);
}

async function stopTracing(session: CDPSession): Promise<{ readonly dataLossOccurred: boolean }> {
  const complete = new Promise<{ readonly dataLossOccurred: boolean }>((resolve) => {
    session.once('Tracing.tracingComplete', (event) => {
      resolve({ dataLossOccurred: event.dataLossOccurred });
    });
  });
  await session.send('Tracing.end');
  return complete;
}

function createTraceCapture(maximumBytes: number): TraceCapture {
  const chunks: Array<{ readonly body: string; readonly bytes: number; readonly eventCount: number }> = [];
  const gc = {
    major: { count: 0, maxDurationMs: 0, totalDurationMs: 0 },
    minor: { count: 0, maxDurationMs: 0, totalDurationMs: 0 },
  };
  let droppedChunkCount = 0;
  let droppedBytes = 0;
  let retainedBytes = 0;
  let retainedEventCount = 0;
  let totalEventCount = 0;

  return {
    add(events) {
      totalEventCount += events.length;
      for (const event of events) {
        const target = event.name === 'MajorGC' ? gc.major : event.name === 'MinorGC' ? gc.minor : undefined;
        if (target === undefined || typeof event.dur !== 'number' || !Number.isFinite(event.dur)) continue;
        const durationMilliseconds = Math.max(0, event.dur) / 1_000;
        target.count += 1;
        target.maxDurationMs = Math.max(target.maxDurationMs, durationMilliseconds);
        target.totalDurationMs += durationMilliseconds;
      }

      const body = JSON.stringify(events).slice(1, -1);
      const bytes = Buffer.byteLength(body);
      if (bytes > maximumBytes) {
        droppedChunkCount += 1;
        droppedBytes += bytes;
        return;
      }
      while (retainedBytes + bytes > maximumBytes && chunks.length !== 0) {
        const removed = chunks.shift()!;
        retainedBytes -= removed.bytes;
        retainedEventCount -= removed.eventCount;
        droppedChunkCount += 1;
        droppedBytes += removed.bytes;
      }
      chunks.push({ body, bytes, eventCount: events.length });
      retainedBytes += bytes;
      retainedEventCount += events.length;
    },
    document: () =>
      `{"traceEvents":[${chunks
        .map(({ body }) => body)
        .filter(Boolean)
        .join(',')}]}`,
    summary: () => ({
      droppedBytes,
      droppedChunkCount,
      gc,
      retainedBytes,
      retainedEventCount,
      totalEventCount,
    }),
  };
}

function maximum(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function maximumDataset(samples: readonly BrowserSample[], key: string): number | undefined {
  const values = samples.flatMap((sample) => {
    const value = datasetNumber(sample, key);
    return value === undefined ? [] : [value];
  });
  return values.length === 0 ? undefined : maximum(values);
}

function datasetNumber(sample: BrowserSample, key: string): number | undefined {
  const value = Number(sample.dataset[key]);
  return Number.isFinite(value) ? value : undefined;
}

function integerOption(name: string, fallback: number, minimum: number, maximumValue: number): number {
  const value = stringOption(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximumValue) {
    throw new RangeError(`${name} must be an integer in [${String(minimum)}, ${String(maximumValue)}]`);
  }
  return parsed;
}

function stringOption(name: string): string | undefined {
  const index = process.argv.lastIndexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new TypeError(`${name} requires a value`);
  return value;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
