export {};

const techniques = [
  { id: 'bitmap', label: 'Bitmap' },
  { id: 'mtsdf', label: 'MSDF' },
  { id: 'slug', label: 'Slug' },
] as const;
const workloads = [
  { id: 'benchmark-ipsum', label: 'Benchmark ipsum' },
  { id: 'advanced-shaping', label: 'Advanced shaping' },
  { id: 'text-ladder', label: 'Text ladder' },
  { id: 'zoom-text', label: 'Zoom text' },
  { id: 'icon-grid', label: 'Icon grid' },
  { id: 'off-axis-3d', label: 'Off-axis / 3D' },
  { id: 'dynamic-layout', label: 'Dynamic layout' },
  { id: 'paragraph-stress', label: 'Paragraph stress' },
  { id: 'paint-effects', label: 'Paint & effects' },
] as const;
const comparisonWorkloads = new Set([
  'text-ladder',
  'zoom-text',
  'icon-grid',
  'off-axis-3d',
  'dynamic-layout',
  'paragraph-stress',
  'paint-effects',
]);

type Technique = (typeof techniques)[number]['id'];

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

async function selectTechnique(id: Technique, label: string): Promise<void> {
  if (new URLSearchParams(location.search).get('technique') === id) return;
  const button = visible(
    [...document.querySelectorAll<HTMLButtonElement>('button')].filter(
      (candidate) => candidate.textContent?.trim() === label,
    ),
  );
  if (button === undefined) throw new Error(`Missing ${label} technique button`);
  button.click();
  await waitFor(() => (new URLSearchParams(location.search).get('technique') === id ? true : undefined));
}

async function selectWorkload(id: string, label: string): Promise<void> {
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

async function completeAdvancedShaping(): Promise<void> {
  const trigger = await waitFor(() =>
    [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.getAttribute('aria-label')?.startsWith('Shaping timeline:'),
    ),
  );
  console.log('presentation-advanced-timeline-trigger-ready', trigger.getAttribute('aria-label'));
  trigger.click();
  const timelineAction = await waitFor(() =>
    visible(
      [...document.querySelectorAll<HTMLButtonElement>('button')].filter((button) =>
        ['Pause', 'Play'].includes(button.textContent?.trim() ?? ''),
      ),
    ),
  );
  console.log('presentation-advanced-timeline-action-ready', timelineAction.textContent?.trim());
  if (timelineAction.textContent?.trim() === 'Pause') timelineAction.click();
  const sliderRoot = await waitFor(() => {
    const candidate = document.querySelector<HTMLElement>('[data-slot="slider"][aria-label="Shaping timeline"]');
    return candidate ?? undefined;
  });
  const slider = sliderRoot.querySelector<HTMLInputElement>('input[type="range"]');
  if (slider === null) throw new Error('Advanced shaping timeline is missing its range input');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('Native range value setter is unavailable');
  setter.call(slider, slider.max);
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  slider.dispatchEvent(new Event('change', { bubbles: true }));
  console.log('presentation-advanced-timeline-completed', slider.max);
}

async function readyViewport(technique: Technique, workload: string): Promise<HTMLElement> {
  const selector = comparisonWorkloads.has(workload)
    ? `[data-testid="comparison-live-viewport"][data-technique="${technique}"][data-workload="${workload}"]`
    : `[data-testid="${technique}-live-viewport"]`;
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

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? Number.NaN;
}

async function sampleRaf(
  durationMs: number,
): Promise<{ fps: number; p95FrameMs: number; maxFrameMs: number; slow: number }> {
  const deltas: number[] = [];
  const start = performance.now();
  let previous = start;
  await new Promise<void>((resolve) => {
    const frame = (now: number): void => {
      deltas.push(now - previous);
      previous = now;
      if (now - start >= durationMs) resolve();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  const elapsed = deltas.reduce((sum, value) => sum + value, 0);
  return {
    fps: (deltas.length * 1_000) / elapsed,
    p95FrameMs: percentile(deltas, 0.95),
    maxFrameMs: Math.max(...deltas),
    slow: deltas.filter((value) => value > 20).length,
  };
}

const results: Array<Record<string, number | string>> = [];
for (const technique of techniques) {
  await selectTechnique(technique.id, technique.label);
  for (const workload of workloads) {
    await selectWorkload(workload.id, workload.label);
    if (workload.id === 'advanced-shaping') await completeAdvancedShaping();
    const viewport = await readyViewport(technique.id, workload.id);
    await waitFrames(30);
    const raf = await sampleRaf(1_500);
    const record = {
      technique: technique.id,
      workload: workload.id,
      rafFps: Number(raf.fps.toFixed(1)),
      p95FrameMs: Number(raf.p95FrameMs.toFixed(2)),
      maxFrameMs: Number(raf.maxFrameMs.toFixed(2)),
      slowFrames: raf.slow,
      reportedFps: Number(viewport.getAttribute('data-frames-per-second')),
      cpuSubmitMs: Number(viewport.getAttribute('data-median-submit-ms')),
      gpuMs: Number(viewport.getAttribute('data-median-gpu-ms')),
      glyphs: Number(viewport.getAttribute('data-glyph-count')),
      draws: Number(viewport.getAttribute('data-draw-count')),
    };
    results.push(record);
    console.log('presentation-fps-cell', JSON.stringify(record));
  }
}
console.log('presentation-fps-sweep-ready', JSON.stringify(results));
/* @workflow
{
  "name": "benchmark:presentation-performance",
  "summary": "Measure the complete Presentation workload cadence on hardware WebGPU.",
  "requirements": "GPU-enabled Chromium and Vitexec.",
  "writes": "Standard output only.",
  "args": [
    "--gpu",
    "--path",
    "/presentation?mode=benchmark&technique=bitmap&backend=webgpu&delivery=baked&dpr=2&font=inter&workload=benchmark-ipsum"
  ]
}
*/
