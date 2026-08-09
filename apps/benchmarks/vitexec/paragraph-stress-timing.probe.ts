export {};

const viewport = await waitForViewport();
performance.clearMeasures();
const initialReflows = integerAttribute(viewport, 'data-reflow-count');
const targetReflows = initialReflows + 16;
const frameDeltas: number[] = [];
let previousFrame = performance.now();

await new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`timed out at reflow ${viewport.dataset.reflowCount}`)), 30_000);
  const frame = (timestamp: number): void => {
    frameDeltas.push(timestamp - previousFrame);
    previousFrame = timestamp;
    if (integerAttribute(viewport, 'data-reflow-count') >= targetReflows) {
      clearTimeout(timeout);
      resolve();
    } else {
      requestAnimationFrame(frame);
    }
  };
  requestAnimationFrame(frame);
});

const measures = performance.getEntriesByType('measure') as PerformanceMeasure[];
const summaries = Object.fromEntries(
  [...new Set(measures.map(({ name }) => name))]
    .sort()
    .map((name) => [name, summarize(measures.filter((entry) => entry.name === name).map(({ duration }) => duration))]),
);
const elapsed = frameDeltas.reduce((sum, duration) => sum + duration, 0);
console.log(
  'paragraph-stress-timing-ready',
  JSON.stringify({
    draws: integerAttribute(viewport, 'data-draw-count'),
    engineUpdates: measures.filter(({ name }) => name === '@pmndrs/text engine.update').length,
    finalReflows: integerAttribute(viewport, 'data-reflow-count'),
    glyphs: integerAttribute(viewport, 'data-glyph-count'),
    measuredReflows: targetReflows - initialReflows,
    rafFps: Number(((frameDeltas.length * 1_000) / elapsed).toFixed(1)),
    rafMaxMs: Number(Math.max(...frameDeltas).toFixed(3)),
    rafP95Ms: Number(percentile(frameDeltas, 0.95).toFixed(3)),
    summaries,
  }),
);

function waitForViewport(): Promise<HTMLElement> {
  const find = (): HTMLElement | undefined => {
    const candidate = document.querySelector<HTMLElement>(
      '[data-testid="comparison-live-viewport"][data-workload="paragraph-stress"]',
    );
    return candidate !== null &&
      Number(candidate.dataset.framesPerSecond) > 0 &&
      Number(candidate.dataset.glyphCount) > 0
      ? candidate
      : undefined;
  };
  const current = find();
  if (current !== undefined) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error('timed out waiting for Paragraph Stress'));
    }, 60_000);
    const observer = new MutationObserver(() => {
      const candidate = find();
      if (candidate === undefined) return;
      clearTimeout(timeout);
      observer.disconnect();
      resolve(candidate);
    });
    observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true });
  });
}

function integerAttribute(element: HTMLElement, name: string): number {
  const value = Number(element.getAttribute(name));
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} is not a nonnegative integer`);
  return value;
}

function summarize(values: readonly number[]): Record<string, number> {
  return {
    count: values.length,
    maxMs: Number(Math.max(...values).toFixed(3)),
    medianMs: Number(percentile(values, 0.5).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
    totalMs: Number(values.reduce((sum, value) => sum + value, 0).toFixed(3)),
  };
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]!;
}

/* @workflow
{
  "name": "benchmark:paragraph-stress-timing",
  "summary": "Attribute Paragraph Stress reflow and frame time through User Timing spans.",
  "requirements": "GPU-enabled Chromium and Vitexec.",
  "writes": "Standard output; optional caller-owned CPU and performance traces.",
  "args": [
    "--gpu",
    "--path",
    "/presentation?mode=benchmark&technique=mtsdf&backend=webgpu&delivery=baked&dpr=2&font=inter&workload=paragraph-stress&textTimings=1"
  ]
}
*/
