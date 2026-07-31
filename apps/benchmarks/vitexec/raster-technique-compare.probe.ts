export {};

function waitForElement(selector: string): Promise<HTMLElement> {
  const current = document.querySelector<HTMLElement>(selector);
  if (current !== null) return Promise.resolve(current);
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const element = document.querySelector<HTMLElement>(selector);
      if (element === null) return;
      observer.disconnect();
      resolve(element);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

function waitForHeading(text: string): Promise<void> {
  const matches = (): boolean =>
    [...document.querySelectorAll('h1')].some((heading) => heading.textContent?.trim() === text);
  if (matches()) return Promise.resolve();
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (!matches()) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
}

function waitForReadyComparison(): Promise<HTMLElement> {
  return waitForElement('[data-testid="raster-technique-comparison"]').then((surface) => {
    if (surface.dataset.conformanceReady === 'true') return surface;
    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const error = surface.querySelector<HTMLElement>('.text-danger');
        if (error !== null) {
          observer.disconnect();
          reject(new Error(error.textContent ?? 'GPU comparison failed'));
          return;
        }
        if (surface.dataset.conformanceReady !== 'true') return;
        observer.disconnect();
        resolve(surface);
      });
      observer.observe(surface, { attributes: true, childList: true, subtree: true });
    });
  });
}

function workloadButton(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.includes(label) === true && !candidate.disabled,
  );
  if (button === undefined) throw new Error(`${label} workload is unavailable`);
  return button;
}

await waitForHeading('MSDF / Slug compare');
let surface = await waitForReadyComparison();
const canvas = surface.querySelector('canvas');
if (!(canvas instanceof HTMLCanvasElement) || canvas.width <= 0 || canvas.height <= 0) {
  throw new Error('GPU comparison did not allocate a visible canvas');
}
assertExclusiveRenderer(canvas, 'initial comparison');
for (const label of ['MSDF', 'Slug', 'Delta ×8 · red MSDF / cyan Slug']) {
  if (!surface.textContent?.includes(label)) throw new Error(`${label} comparison panel is missing`);
}
const comparisonInput = document.querySelector<HTMLTextAreaElement>('textarea');
const setTextareaValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
if (comparisonInput === null || setTextareaValue === undefined) {
  throw new Error('Comparison text input is missing');
}
const authoredText = 'MSDF ↔ Slug\nAVATAR ffi 0123456789';
setTextareaValue.call(comparisonInput, authoredText);
comparisonInput.dispatchEvent(new Event('input', { bubbles: true }));
if (surface.dataset.comparisonText !== authoredText) {
  await new Promise<void>((resolve) => {
    const observer = new MutationObserver(() => {
      if (surface.dataset.comparisonText !== authoredText) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(surface, { attributes: true, attributeFilter: ['data-comparison-text'] });
  });
}

const pipeline = workloadButton('Pipeline accuracy');
const switchStartedAt = performance.now();
pipeline.click();
await waitForHeading('Pipeline accuracy');
const switchElapsedMs = performance.now() - switchStartedAt;
const finiteSurface = await waitForElement('[data-testid="conformance-surface"]');
if (finiteSurface.dataset.conformanceReady !== 'false') {
  throw new Error('Finite CPU conformance started before the explicit run action');
}

const runButton = document.querySelector<HTMLButtonElement>('button[aria-label="Run conformance"]');
if (runButton === null || runButton.disabled) throw new Error('Explicit conformance action is unavailable');
runButton.click();
workloadButton('MSDF / Slug compare').click();
await waitForHeading('MSDF / Slug compare');
surface = await waitForReadyComparison();
assertComparisonCanvas(surface, canvas, 'aborted conformance recovery');
const liveAction = document.querySelector<HTMLButtonElement>('button[aria-label="Live GPU comparison"]');
if (liveAction === null) throw new Error('Live comparison action is missing');
if (liveAction.textContent?.includes('Running') === true) {
  await new Promise<void>((resolve) => {
    const observer = new MutationObserver(() => {
      if (liveAction.textContent?.includes('Running') === true) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(liveAction, { childList: true, subtree: true, characterData: true });
  });
}
workloadButton('Pipeline accuracy').click();
await waitForHeading('Pipeline accuracy');
const postRunSurface = await waitForElement('[data-testid="conformance-surface"]');
if (postRunSurface.dataset.conformanceReady !== 'false') {
  throw new Error('A completed run crossed workloads and started the finite CPU capture');
}
assertExclusiveRenderer(canvas, 'post-abort finite surface');

const recoveryRunButton = document.querySelector<HTMLButtonElement>('button[aria-label="Run conformance"]');
if (recoveryRunButton === null || recoveryRunButton.disabled) {
  throw new Error('Conformance action did not recover after abort');
}
recoveryRunButton.click();
await waitForExecutionSummary();
console.log('raster-technique-compare-finite-capture-started');
await waitForFiniteCapture();
assertExclusiveRenderer(canvas, 'successful finite capture');

workloadButton('MSDF / Slug compare').click();
await waitForHeading('MSDF / Slug compare');
surface = await waitForReadyComparison();
assertComparisonCanvas(surface, canvas, 'successful capture recovery');
const zoom = document.querySelector<HTMLInputElement>('input[type="range"][min="1"][max="8"]');
const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
if (zoom === null || setInputValue === undefined) throw new Error('Comparison zoom control is missing');
setInputValue.call(zoom, '4');
zoom.dispatchEvent(new Event('input', { bubbles: true }));
const updatedCanvas = surface.querySelector('canvas');
if (!(updatedCanvas instanceof HTMLCanvasElement)) throw new Error('Comparison canvas was replaced');
const comparisonViewport = surface.querySelector<HTMLElement>('[data-zoom]');
if (comparisonViewport === null) throw new Error('Comparison viewport is missing its committed view state');
await new Promise<void>((resolve) => {
  if (comparisonViewport.dataset.zoom === '4') {
    resolve();
    return;
  }
  const observer = new MutationObserver(() => {
    if (comparisonViewport.dataset.zoom !== '4') return;
    observer.disconnect();
    resolve();
  });
  observer.observe(comparisonViewport, { attributes: true, attributeFilter: ['data-zoom'] });
});
assertComparisonCanvas(surface, canvas, 'view update');

console.log(
  'raster-technique-compare-ready',
  JSON.stringify({
    backend: new URL(location.href).searchParams.get('backend'),
    dpr: new URL(location.href).searchParams.get('dpr'),
    switchElapsedMs,
    width: updatedCanvas.width,
    height: updatedCanvas.height,
    text: surface.dataset.comparisonText,
    zoom: comparisonViewport.dataset.zoom,
  }),
);

function waitForFiniteCapture(): Promise<HTMLElement> {
  const find = (): HTMLElement | undefined =>
    document.querySelector<HTMLElement>('[data-testid="conformance-surface"][data-conformance-ready="true"]') ??
    undefined;
  const current = find();
  if (current !== undefined) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const error = document.querySelector<HTMLElement>('[data-testid="scene"] .text-danger');
      if (error !== null) {
        observer.disconnect();
        reject(new Error(error.textContent ?? 'Finite capture failed'));
        return;
      }
      const capture = find();
      if (capture === undefined) return;
      observer.disconnect();
      resolve(capture);
    });
    observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true });
  });
}

function waitForExecutionSummary(): Promise<void> {
  const find = (): boolean =>
    document.querySelector<HTMLElement>('[data-testid="scene"]')?.dataset.executionId !== undefined;
  if (find()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const error = document.querySelector<HTMLElement>('[data-testid="scene"] .text-danger');
      if (error !== null) {
        observer.disconnect();
        reject(new Error(error.textContent ?? 'Conformance run failed'));
        return;
      }
      if (!find()) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true });
  });
}

function assertComparisonCanvas(comparisonSurface: HTMLElement, expected: HTMLCanvasElement, label: string): void {
  if (comparisonSurface.querySelector('canvas') !== expected) throw new Error(`${label} replaced the route canvas`);
  assertExclusiveRenderer(expected, label);
}

function assertExclusiveRenderer(rendererCanvas: HTMLCanvasElement, label: string): void {
  const active = Number(document.documentElement.dataset.activeConfiguredRenderers);
  const peak = Number(document.documentElement.dataset.peakConfiguredRenderers);
  if (active !== 1 || peak !== 1) {
    throw new Error(`${label} observed configured renderer counts active=${String(active)} peak=${String(peak)}`);
  }
  if (
    rendererCanvas.dataset.configuredRendererActive !== 'true' ||
    rendererCanvas.dataset.configuredRendererId === undefined
  ) {
    throw new Error(`${label} lost the route renderer identity`);
  }
}
