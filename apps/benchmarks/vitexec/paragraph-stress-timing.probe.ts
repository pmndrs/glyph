export {};

const frameTimeModulePath = '/src/benchmark/frame-time.ts';
const { sampleAnimationPerformance }: typeof import('../src/benchmark/frame-time') = await import(
  /* @vite-ignore */ frameTimeModulePath
);
const telemetryModulePath = '/src/renderer/live-frame-telemetry.ts';
const { requestLiveFrameTelemetryCapture }: typeof import('../src/renderer/live-frame-telemetry') = await import(
  /* @vite-ignore */ telemetryModulePath
);
const viewport = await waitForViewport();
const initialReflows = integerAttribute(viewport, 'data-reflow-count');
const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-configured-renderer-active="true"]');
if (canvas === null) throw new Error('Paragraph Stress sample lost its renderer canvas');
const { cpuTime, summary: frameTime } = await sampleAnimationPerformance(window, async (sampleFrames) => {
  const capture = await requestLiveFrameTelemetryCapture(canvas, {
    cpuSampleCount: sampleFrames,
    gpuSampleCount: 0,
    signal: AbortSignal.timeout(60_000),
  });
  return capture.cpuMs;
});
const finalReflows = integerAttribute(viewport, 'data-reflow-count');
const measuredReflows = finalReflows - initialReflows;

console.log(
  'paragraph-stress-timing-ready',
  JSON.stringify({
    draws: integerAttribute(viewport, 'data-draw-count'),
    cpuTime,
    finalReflows,
    frameTime,
    glyphs: integerAttribute(viewport, 'data-glyph-count'),
    measuredReflows,
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

/* @workflow { "name": "benchmark:paragraph-stress-timing", "summary": "Measure the ordinary Paragraph Stress demo with the shared frame-time sampler.", "requirements": "GPU-enabled Chromium and Vitexec.", "writes": "Standard output only.", "args": ["--gpu", "--path", "/presentation?technique=mtsdf&backend=webgpu&delivery=baked&dpr=2&font=inter&workload=paragraph-stress"] } */
