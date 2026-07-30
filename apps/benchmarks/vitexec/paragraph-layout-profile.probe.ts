export {};

function waitFor<T>(find: () => T | undefined, timeoutMs = 20_000): Promise<T> {
  const current = find();
  if (current !== undefined) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error('Timed out waiting for paragraph profile state'));
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

function rangeControl(label: string): HTMLInputElement {
  const control = [...document.querySelectorAll<HTMLInputElement>('input[type="range"]')].find(
    (candidate) => candidate.labels?.[0]?.textContent?.includes(label) === true,
  );
  if (control === undefined) throw new Error(`${label} range is unavailable`);
  return control;
}

function setRange(control: HTMLInputElement, value: number): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('Native input value setter is unavailable');
  setter.call(control, String(value));
  control.dispatchEvent(new Event('input', { bubbles: true }));
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? Number.NaN;
}

function waitFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const next = (): void => {
      count -= 1;
      if (count === 0) resolve();
      else requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  });
}

const controlsButton = await waitFor(() =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === 'Controls',
  ),
);
if (controlsButton.getAttribute('aria-expanded') !== 'true') controlsButton.click();
await waitFor(() => (document.querySelector('input[type="range"]') instanceof HTMLInputElement ? true : undefined));

const viewport = await waitFor(() => {
  const candidate = document.querySelector<HTMLElement>(
    '[data-testid="comparison-live-viewport"][data-technique="mtsdf"][data-workload="paragraph-stress"]',
  );
  if (
    candidate === null ||
    candidate.getAttribute('data-presentation-pending') !== 'false' ||
    candidate.getAttribute('data-missing-glyph-count') !== '0'
  ) {
    return undefined;
  }
  return candidate;
});
const volume = rangeControl('Text volume');
const width = rangeControl('Layout width');
setRange(volume, 100);
await waitFor(() =>
  Number(viewport.getAttribute('data-configuration-revision')) > 1 &&
  viewport.getAttribute('data-presentation-pending') === 'false'
    ? true
    : undefined,
);
await waitFrames(12);

const frameDeltas: number[] = [];
const longTasks: number[] = [];
const longTaskObserver = PerformanceObserver.supportedEntryTypes.includes('longtask')
  ? new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration);
    })
  : undefined;
longTaskObserver?.observe({ entryTypes: ['longtask'] });
const memoryBefore = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
const reflowCountBefore = Number(viewport.getAttribute('data-reflow-count'));
const started = performance.now();
let previous = started;
let inputCount = 0;

await new Promise<void>((resolve) => {
  const frame = (now: number): void => {
    frameDeltas.push(now - previous);
    previous = now;
    const phase = ((now - started) % 2_000) / 2_000;
    const triangle = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
    setRange(width, 40 + Math.round(triangle * 30) * 2);
    inputCount += 1;
    if (now - started >= 6_000) resolve();
    else requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
});
setRange(width, 82);
await waitFor(() => (viewport.getAttribute('data-presentation-pending') === 'false' ? true : undefined));
await waitFrames(12);
longTaskObserver?.disconnect();

const elapsed = frameDeltas.reduce((sum, value) => sum + value, 0);
const memoryAfter = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
console.log(
  'paragraph-layout-profile-ready',
  JSON.stringify({
    inputCount,
    rafFps: (frameDeltas.length * 1_000) / elapsed,
    p95FrameMs: percentile(frameDeltas, 0.95),
    p99FrameMs: percentile(frameDeltas, 0.99),
    maxFrameMs: Math.max(...frameDeltas),
    framesOver16_67: frameDeltas.filter((value) => value > 16.67).length,
    framesOver25: frameDeltas.filter((value) => value > 25).length,
    longTaskCount: longTasks.length,
    longTaskTotalMs: longTasks.reduce((sum, value) => sum + value, 0),
    longTaskMaxMs: longTasks.length === 0 ? 0 : Math.max(...longTasks),
    reflowCountDelta: Number(viewport.getAttribute('data-reflow-count')) - reflowCountBefore,
    lastReflowMs: Number(viewport.getAttribute('data-reflow-ms')),
    cpuSubmitMs: Number(viewport.getAttribute('data-median-submit-ms')),
    gpuMs: Number(viewport.getAttribute('data-median-gpu-ms')),
    memoryDelta: memoryBefore === undefined || memoryAfter === undefined ? null : memoryAfter - memoryBefore,
  }),
);
