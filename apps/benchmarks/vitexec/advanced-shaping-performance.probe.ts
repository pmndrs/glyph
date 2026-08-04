const advancedShapingPath = '/src/workloads/advanced-shaping/scene.ts';
const environmentPath = '/src/benchmark/environment.ts';
const STEADY_STATE_REPORT_COUNT = 12;
const [{ ADVANCED_SHAPING_CASES }, { environmentResource }] = await Promise.all([
  import(/* @vite-ignore */ advancedShapingPath),
  import(/* @vite-ignore */ environmentPath),
]);

console.log('advanced-shaping-performance-start');

const caseSelector = await waitForCustomSelect('Case');
const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
if (setInputValue === undefined) throw new Error('Native input value setter is unavailable');
(await waitForButtonText('Pause')).click();
await waitForButtonText('Play');

const cases: Array<Record<string, number | string>> = [];
for (const definition of ADVANCED_SHAPING_CASES) {
  console.log('advanced-shaping-performance-select', definition.id);
  await selectCustomOption(caseSelector, definition.label);
  const authoredText = definition.showcaseRevealUnits.join('');
  const timeline = await waitForRangeMaximum('Timeline', String(definition.showcaseRevealUnits.length));
  setInputValue.call(timeline, String(definition.showcaseRevealUnits.length));
  timeline.dispatchEvent(new Event('input', { bubbles: true }));
  const viewport = await waitForLiveViewportState({
    'data-backend': 'webgpu',
    'data-dpr': '1',
    'data-presentation-progress': '1',
    'data-settled-tick': String(definition.showcaseRevealUnits.length),
    'data-settled-text-length': String(authoredText.length),
    'data-missing-glyph-count': '0',
  });
  if (viewport.getAttribute('data-gpu-timing-supported') !== 'true') {
    throw new Error(`${definition.id} did not expose WebGPU timestamp queries`);
  }
  console.log('advanced-shaping-performance-settled', definition.id);
  const previousFrameCount = numericAttribute(viewport, 'data-frame-count');
  await waitForTelemetryReports(viewport, previousFrameCount, STEADY_STATE_REPORT_COUNT);
  console.log('advanced-shaping-performance-sampled', definition.id);
  cases.push({
    id: definition.id,
    fontFixture: definition.fontFixture,
    textReadyMs: numericAttribute(viewport, 'data-text-ready-ms'),
    rendererInitMs: numericAttribute(viewport, 'data-renderer-init-ms'),
    fontLoadMs: numericAttribute(viewport, 'data-font-load-ms'),
    firstDrawMs: numericAttribute(viewport, 'data-first-draw-ms'),
    startupMs: numericAttribute(viewport, 'data-startup-ms'),
    framesPerSecond: numericAttribute(viewport, 'data-frames-per-second'),
    medianSubmitMs: numericAttribute(viewport, 'data-median-submit-ms'),
    p95SubmitMs: numericAttribute(viewport, 'data-p95-submit-ms'),
    medianGpuMs: numericAttribute(viewport, 'data-median-gpu-ms'),
    p95GpuMs: numericAttribute(viewport, 'data-p95-gpu-ms'),
    glyphCount: numericAttribute(viewport, 'data-glyph-count'),
    drawCount: numericAttribute(viewport, 'data-draw-count'),
    artifactBytes: numericAttribute(viewport, 'data-artifact-bytes'),
    atlasGpuBytes: numericAttribute(viewport, 'data-atlas-gpu-bytes'),
    totalGpuBytes: numericAttribute(viewport, 'data-total-gpu-bytes'),
  });
}

const gpuAdapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
const gpuAdapterInfo = gpuAdapter?.info;
console.log(
  'advanced-shaping-performance-ready',
  JSON.stringify({
    schemaVersion: 0,
    kind: 'live-performance-observation',
    capturedAt: new Date().toISOString(),
    backend: 'webgpu',
    dpr: 1,
    steadyStateReportCount: STEADY_STATE_REPORT_COUNT,
    environment: await environmentResource(),
    gpuAdapter:
      gpuAdapterInfo === undefined
        ? undefined
        : {
            architecture: gpuAdapterInfo.architecture,
            description: gpuAdapterInfo.description,
            device: gpuAdapterInfo.device,
            vendor: gpuAdapterInfo.vendor,
          },
    cases,
  }),
);

function waitForCustomSelect(label: string): Promise<HTMLButtonElement> {
  const find = (): HTMLButtonElement | undefined =>
    [...document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]')].find(
      (candidate) => candidate.getAttribute('aria-label') === label,
    );
  const current = find();
  if (current !== undefined) return Promise.resolve(current);
  return observeUntil(document.documentElement, find);
}

function waitForButtonText(label: string): Promise<HTMLButtonElement> {
  const find = (): HTMLButtonElement | undefined =>
    [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => !candidate.disabled && candidate.textContent?.trim() === label,
    );
  const current = find();
  if (current !== undefined) return Promise.resolve(current);
  return observeUntil(document.documentElement, find);
}

function waitForRangeMaximum(label: string, maximum: string): Promise<HTMLInputElement> {
  const find = (): HTMLInputElement | undefined =>
    [...document.querySelectorAll<HTMLInputElement>('input[type="range"]')].find(
      (candidate) => candidate.labels?.[0]?.textContent?.includes(label) === true && candidate.max === maximum,
    );
  const current = find();
  if (current !== undefined) return Promise.resolve(current);
  return observeUntil(document.documentElement, find);
}

async function selectCustomOption(control: HTMLButtonElement, label: string): Promise<void> {
  if (control.textContent?.trim() === label) return;
  control.click();
  const option = await observeUntil(document.documentElement, () =>
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (candidate) => candidate.textContent?.trim() === label,
    ),
  );
  option.click();
}

function waitForLiveViewportState(attributes: Readonly<Record<string, string>>): Promise<HTMLElement> {
  const find = (): HTMLElement | undefined => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="bitmap-live-viewport"]');
    if (
      viewport === null ||
      Object.entries(attributes).some(([name, value]) => viewport.getAttribute(name) !== value)
    ) {
      return undefined;
    }
    return viewport;
  };
  const current = find();
  if (current !== undefined) return Promise.resolve(current);
  return observeUntil(document.documentElement, find);
}

function waitForGreaterNumericAttribute(element: HTMLElement, name: string, previous: number): Promise<number> {
  const find = (): number | undefined => {
    const value = numericAttribute(element, name);
    return value > previous ? value : undefined;
  };
  const current = find();
  if (current !== undefined) return Promise.resolve(current);
  return observeUntil(element, find, { attributes: true, attributeFilter: [name] });
}

async function waitForTelemetryReports(element: HTMLElement, frameCount: number, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    frameCount = await waitForGreaterNumericAttribute(element, 'data-frame-count', frameCount);
  }
}

function numericAttribute(element: HTMLElement, name: string): number {
  const raw = element.getAttribute(name);
  if (raw === null) throw new Error(`${name} is missing from the live viewport`);
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} is not a finite non-negative live metric`);
  }
  return value;
}

function observeUntil<T>(
  root: Node,
  read: () => T | undefined,
  options: MutationObserverInit = { attributes: true, childList: true, subtree: true },
): Promise<T> {
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const value = read();
      if (value === undefined) return;
      observer.disconnect();
      resolve(value);
    });
    observer.observe(root, options);
  });
}

export {};
