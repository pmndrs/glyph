interface ChromiumPerformanceMemory {
  readonly usedJSHeapSize: number;
}

export {};

const viewportSelector = '[data-testid="comparison-live-viewport"][data-technique="bitmap"][data-workload="icon-grid"]';
const sampleCapacity = 1_800;
const sampleDurationMs = 20_000;
const frameDeltas = new Float64Array(sampleCapacity);
const heapSizes = new Float64Array(sampleCapacity);

function performanceMemory(): ChromiumPerformanceMemory | undefined {
  return (performance as Performance & { readonly memory?: ChromiumPerformanceMemory }).memory;
}

function waitForReadyViewport(): Promise<HTMLElement> {
  const find = (): HTMLElement | undefined => {
    const viewport = document.querySelector<HTMLElement>(viewportSelector);
    const framesPerSecond = Number(viewport?.getAttribute('data-frames-per-second'));
    return viewport !== null && framesPerSecond > 0 ? viewport : undefined;
  };
  const current = find();
  if (current !== undefined) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const viewport = find();
      if (viewport === undefined) return;
      observer.disconnect();
      resolve(viewport);
    });
    observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true });
    window.addEventListener(
      'error',
      (event) => {
        observer.disconnect();
        reject(event.error);
      },
      { once: true },
    );
  });
}

function percentile(values: Float64Array, length: number, ratio: number): number {
  const sorted = values.slice(0, length).sort();
  return sorted[Math.min(length - 1, Math.floor(length * ratio))] ?? Number.NaN;
}

const viewport = await waitForReadyViewport();
const startedAt = performance.now();
const startHeapBytes = performanceMemory()?.usedJSHeapSize;
performance.mark('icon-grid-profile-start');
let previousTimestamp = startedAt;
let sampleCount = 0;
await new Promise<void>((resolve) => {
  const frame = (timestamp: number): void => {
    if (sampleCount >= sampleCapacity || timestamp - startedAt >= sampleDurationMs) {
      resolve();
      return;
    }
    frameDeltas[sampleCount] = timestamp - previousTimestamp;
    heapSizes[sampleCount] = performanceMemory()?.usedJSHeapSize ?? Number.NaN;
    previousTimestamp = timestamp;
    sampleCount += 1;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
});
performance.mark('icon-grid-profile-end');
performance.measure('icon-grid-profile-window', 'icon-grid-profile-start', 'icon-grid-profile-end');
const endHeapBytes = performanceMemory()?.usedJSHeapSize;

let maximumFrameMs = 0;
let slowFrameCount = 0;
let minimumHeapBytes = Number.POSITIVE_INFINITY;
let maximumHeapBytes = Number.NEGATIVE_INFINITY;
for (let index = 0; index < sampleCount; index += 1) {
  const frameMs = frameDeltas[index]!;
  const heapBytes = heapSizes[index]!;
  maximumFrameMs = Math.max(maximumFrameMs, frameMs);
  if (frameMs > 20) slowFrameCount += 1;
  if (Number.isFinite(heapBytes)) {
    minimumHeapBytes = Math.min(minimumHeapBytes, heapBytes);
    maximumHeapBytes = Math.max(maximumHeapBytes, heapBytes);
  }
}

console.log(
  'icon-grid-gc-profile-ready',
  JSON.stringify({
    durationMs: performance.now() - startedAt,
    sampleCount,
    p95FrameMs: percentile(frameDeltas, sampleCount, 0.95),
    maximumFrameMs,
    slowFrameCount,
    minimumHeapBytes: Number.isFinite(minimumHeapBytes) ? minimumHeapBytes : undefined,
    maximumHeapBytes: Number.isFinite(maximumHeapBytes) ? maximumHeapBytes : undefined,
    heapGrowthBytes:
      Number.isFinite(minimumHeapBytes) && Number.isFinite(maximumHeapBytes)
        ? maximumHeapBytes - minimumHeapBytes
        : undefined,
    startHeapBytes,
    endHeapBytes,
    retainedHeapDeltaBytes:
      startHeapBytes === undefined || endHeapBytes === undefined ? undefined : endHeapBytes - startHeapBytes,
    iconRecycleCount: Number(viewport.getAttribute('data-icon-recycle-count')),
    iconWindowRevision: Number(viewport.getAttribute('data-icon-window-revision')),
  }),
);
