const WORKLOADS = [
  { label: 'Text ladder', id: 'text-ladder' },
  { label: 'Zoom text', id: 'zoom-text' },
  { label: 'Icon grid', id: 'icon-grid' },
  { label: 'Off-axis / 3D', id: 'off-axis-3d', amountLabel: 'Perspective intensity' },
  { label: 'Dynamic layout', id: 'dynamic-layout', amountLabel: 'Reflow amplitude' },
  { label: 'Paragraph stress', id: 'paragraph-stress', amountLabel: 'Text volume' },
  { label: 'Paint & effects', id: 'paint-effects', amountLabel: 'Hue spread' },
] as const;

type RasterTechnique = 'bitmap' | 'mtsdf' | 'slug';

await clickButton('1×', true);

for (const technique of ['bitmap', 'mtsdf', 'slug'] as const) {
  await clickButton(techniqueLabel(technique), true);
  for (const workload of WORKLOADS) {
    await clickButton(workload.label, false);
    let viewport = await waitForReadyViewport(technique, workload.id);
    verifyCanvasNavigation(
      viewport,
      workload.id !== 'zoom-text',
      workload.id === 'off-axis-3d',
      workload.id === 'icon-grid',
    );

    if (technique === 'bitmap' && workload.id === 'text-ladder') {
      await waitForAttribute(viewport, 'data-canvas-grid', 'true');
      setPressedButton('Show canvas grid', false);
      await waitForAttribute(viewport, 'data-canvas-grid', 'false');
      setPressedButton('Show canvas grid', true);
      await waitForAttribute(viewport, 'data-canvas-grid', 'true');
    }

    if (workload.id !== 'text-ladder' && workload.id !== 'zoom-text') {
      const revision = numericAttribute(viewport, 'data-configuration-revision');
      const sizeLabel = workload.id === 'icon-grid' ? 'Icon size' : 'Rendered size';
      assertRangeVisualTravel(rangeControl(sizeLabel));
      const renderedSize = setDifferentRange(sizeLabel, technique === 'bitmap' ? 28 : 52);
      viewport = await waitForViewportAttribute(
        technique,
        workload.id,
        'data-rendered-device-px',
        String(renderedSize),
      );
      await waitForGreaterAttribute(viewport, 'data-configuration-revision', revision);
    }

    if (workload.id === 'zoom-text') {
      const displayedFixtures = [...document.querySelectorAll<HTMLElement>('[data-zoom-font-fixture]')];
      if (
        displayedFixtures.length === 0 ||
        displayedFixtures.some((element) => element.dataset.zoomFontFixture !== 'inter') ||
        viewport.dataset.fontFixture !== 'inter'
      ) {
        throw new Error(`${techniqueLabel(technique)} Zoom text exposed a font outside its authenticated Inter corpus`);
      }
      if (Math.abs(numericAttribute(viewport, 'data-zoom-base-css-px') - 8 * (96 / 72)) > 0.000_001) {
        throw new Error(`${techniqueLabel(technique)} Zoom text did not preserve its 8 pt floor`);
      }
      if (numericAttribute(viewport, 'data-missing-glyph-count') !== 0) {
        throw new Error(`${techniqueLabel(technique)} Zoom text published a missing glyph`);
      }
      const updateSamples = numericAttribute(viewport, 'data-text-update-sample-count');
      const reflowCount = numericAttribute(viewport, 'data-reflow-count');
      const phraseRevision = numericAttribute(viewport, 'data-zoom-phrase-revision');
      const speed = setDifferentRange('Animation speed', 100);
      await waitForAttribute(viewport, 'data-animation-speed', String(speed));
      await waitForGreaterAttribute(viewport, 'data-zoom-phrase-revision', phraseRevision);
      if (
        numericAttribute(viewport, 'data-text-update-sample-count') !== updateSamples ||
        numericAttribute(viewport, 'data-reflow-count') !== reflowCount
      ) {
        throw new Error(`${techniqueLabel(technique)} Zoom text reshaped or reflowed during retained scaling`);
      }
    }

    if (workload.id === 'icon-grid') {
      const displayedFixtures = [...document.querySelectorAll<HTMLElement>('[data-icon-font-fixture]')];
      if (
        displayedFixtures.length === 0 ||
        displayedFixtures.some((element) => element.dataset.iconFontFixture !== 'font-awesome-free-6.7.2')
      ) {
        throw new Error(`${techniqueLabel(technique)} icon grid exposed the wrong font fixture`);
      }
      if (
        viewport.getAttribute('data-font-fixture') !== 'font-awesome-free-6.7.2' ||
        viewport.getAttribute('data-label-font-fixture') !== 'inter'
      ) {
        throw new Error(`${techniqueLabel(technique)} icon grid did not report its icon and label fonts separately`);
      }
      const itemCount = numericAttribute(viewport, 'data-icon-item-count');
      const labelCount = numericAttribute(viewport, 'data-icon-label-count');
      const columns = numericAttribute(viewport, 'data-icon-column-count');
      const rows = numericAttribute(viewport, 'data-icon-row-count');
      if (itemCount !== 1_402 || labelCount !== itemCount) {
        throw new Error(`${techniqueLabel(technique)} icon grid omitted an icon or label`);
      }
      if (numericAttribute(viewport, 'data-icon-label-size') !== 11) {
        throw new Error(`${techniqueLabel(technique)} icon labels did not remain fixed at 11 px`);
      }
      const poolCapacity = numericAttribute(viewport, 'data-icon-pool-capacity');
      if (poolCapacity <= 0 || poolCapacity >= itemCount) {
        throw new Error(`${techniqueLabel(technique)} icon grid did not virtualize its tile pool`);
      }
      if (numericAttribute(viewport, 'data-icon-first-visible-index') !== 0) {
        throw new Error(`${techniqueLabel(technique)} icon grid did not begin at the first icon`);
      }
      await verifyIconVirtualization(viewport, technique);
      if (rows !== Math.ceil(itemCount / columns)) {
        throw new Error(`${techniqueLabel(technique)} icon grid published invalid dimensions`);
      }
      if (columns !== 38 || rows !== 37) {
        throw new Error(`${techniqueLabel(technique)} icon catalog is not near-square`);
      }
      if (
        numericAttribute(viewport, 'data-icon-grid-width') <= 0 ||
        numericAttribute(viewport, 'data-icon-grid-height') <= 0 ||
        numericAttribute(viewport, 'data-missing-glyph-count') !== 0
      ) {
        throw new Error(`${techniqueLabel(technique)} icon grid is not render-complete`);
      }
    }

    if ('amountLabel' in workload) {
      const revision = numericAttribute(viewport, 'data-configuration-revision');
      const amount = setDifferentRange(workload.amountLabel, 72);
      await waitForAttribute(viewport, 'data-workload-amount', String(amount));
      await waitForGreaterAttribute(viewport, 'data-configuration-revision', revision);
    }

    if (workload.id === 'dynamic-layout') {
      const reflowCount = numericAttribute(viewport, 'data-reflow-count');
      setRange('Layout width', 64);
      setCheckbox('Animate', false);
      await waitForAttribute(viewport, 'data-animation-enabled', 'false');
      console.log('dynamic-layout-animation-paused', technique);
      const speed = setDifferentRange('Animation speed', 37);
      await waitForAttribute(viewport, 'data-animation-speed', String(speed));
      console.log('dynamic-layout-speed-applied', technique);
      setCheckbox('Animate', true);
      await waitForAttribute(viewport, 'data-animation-enabled', 'true');
      console.log('dynamic-layout-animation-resumed', technique);
      await waitForGreaterAttribute(viewport, 'data-reflow-count', reflowCount);
      if (numericAttribute(viewport, 'data-reflow-ms') <= 0) {
        throw new Error('Dynamic layout did not publish a measured asynchronous reflow');
      }
      const boundsRevision = numericAttribute(viewport, 'data-configuration-revision');
      setCheckbox('Show layout bounds', false);
      await waitForAttribute(viewport, 'data-layout-bounds-visible', 'false');
      await waitForGreaterAttribute(viewport, 'data-configuration-revision', boundsRevision);
      setCheckbox('Show layout bounds', true);
      await waitForAttribute(viewport, 'data-layout-bounds-visible', 'true');
    }

    if (workload.id === 'paint-effects') {
      const paintRevision = numericAttribute(viewport, 'data-paint-revision');
      const layoutWidth = numericAttribute(viewport, 'data-layout-width');
      const reflowCount = numericAttribute(viewport, 'data-reflow-count');
      const revision = numericAttribute(viewport, 'data-configuration-revision');
      const opacity = setDifferentRange('Opacity', 68);
      await waitForAttribute(viewport, 'data-paint-opacity', String(opacity / 100));
      await waitForGreaterAttribute(viewport, 'data-configuration-revision', revision);
      const stroke = rangeControl(effectControlLabel('Stroke width', technique));
      const shadow = checkboxControl(effectControlLabel('Shadow', technique));
      if (technique !== 'mtsdf') {
        if (!stroke.disabled || stroke.value !== '0') {
          throw new Error(`${techniqueLabel(technique)} Paint & Effects exposed an active stroke`);
        }
        if (!shadow.disabled || shadow.checked) {
          throw new Error(`${techniqueLabel(technique)} Paint & Effects exposed an active shadow`);
        }
      } else {
        if (stroke.disabled) throw new Error('MSDF Paint & Effects disabled its stroke control');
        const strokeRevision = numericAttribute(viewport, 'data-configuration-revision');
        setRange('Stroke width', 61);
        await waitForAttribute(viewport, 'data-paint-stroke-width', '0.61');
        await waitForGreaterAttribute(viewport, 'data-configuration-revision', strokeRevision);
        if (shadow.disabled || !shadow.checked) {
          throw new Error('MSDF Paint & Effects did not initialize its shadow');
        }
        const paintRevisionBeforeShadow = numericAttribute(viewport, 'data-paint-revision');
        setCheckbox('Shadow', false);
        await waitForAttribute(viewport, 'data-paint-shadow-enabled', 'false');
        if (numericAttribute(viewport, 'data-paint-revision') <= paintRevisionBeforeShadow) {
          throw new Error('MSDF shadow control replaced or reset the retained paint batch');
        }
        setCheckbox('Shadow', true);
        await waitForAttribute(viewport, 'data-paint-shadow-enabled', 'true');
      }
      await waitForGreaterAttribute(viewport, 'data-paint-revision', paintRevision);
      if (
        numericAttribute(viewport, 'data-layout-width') !== layoutWidth ||
        numericAttribute(viewport, 'data-reflow-count') !== reflowCount
      ) {
        throw new Error('Paint animation triggered layout work instead of an in-place paint update');
      }
    }
    console.log('comparison-workload-ready', technique, workload.id);
  }
}

function verifyCanvasNavigation(
  viewport: HTMLElement,
  panEnabled: boolean,
  zoomEnabled: boolean,
  clampedAtOrigin: boolean,
): void {
  const canvas = viewport.querySelector<HTMLCanvasElement>('canvas');
  if (canvas === null || canvas.dataset.panEnabled !== String(panEnabled)) {
    throw new Error('Live workload canvas exposed the wrong panning capability');
  }
  if (panEnabled) {
    if (canvas.dataset.touchPan !== 'two-finger') {
      throw new Error('Pannable live workload did not expose two-finger touch panning');
    }
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 41, clientX: 20 }));
    canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: 0, pointerId: 41, clientX: 35 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 41, clientX: 35 }));
    if (Number(canvas.dataset.panX) !== (clampedAtOrigin ? 0 : 15)) {
      throw new Error('Mouse drag did not publish the applied live-canvas pan');
    }
  } else if (canvas.dataset.touchPan !== 'disabled') {
    throw new Error('Centered live workload exposed touch panning');
  }
  if (canvas.dataset.zoomEnabled !== String(zoomEnabled)) {
    throw new Error('Live workload canvas exposed the wrong zoom capability');
  }
  if (zoomEnabled) {
    canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -80 }));
    if (Number(canvas.dataset.zoom) <= 1) throw new Error('Zoom-enabled canvas ignored wheel zoom');
  }
  canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  if (canvas.dataset.panX !== '0' || canvas.dataset.zoom !== '1') {
    throw new Error('Canvas view reset did not restore pan and zoom');
  }
}

async function verifyIconVirtualization(viewport: HTMLElement, technique: RasterTechnique): Promise<void> {
  const canvas = viewport.querySelector<HTMLCanvasElement>('canvas[data-pan-enabled="true"]');
  if (canvas === null) throw new Error('Icon grid canvas is unavailable');
  const maximumScrollY = numericAttribute(viewport, 'data-icon-maximum-scroll-y');
  const maximumScrollX = numericAttribute(viewport, 'data-icon-maximum-scroll-x');
  if (maximumScrollX <= 0 || maximumScrollY <= 0) {
    throw new Error(`${techniqueLabel(technique)} icon grid is not pannable on both axes`);
  }
  const recycleCount = numericAttribute(viewport, 'data-icon-recycle-count');
  canvas.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      pointerId: 51,
      clientX: 100,
      clientY: 100,
    }),
  );
  canvas.dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      button: 0,
      pointerId: 51,
      clientX: 100 - maximumScrollX - 100,
      clientY: 100 - maximumScrollY - 100,
    }),
  );
  canvas.dispatchEvent(
    new PointerEvent('pointerup', {
      bubbles: true,
      button: 0,
      pointerId: 51,
      clientX: 100 - maximumScrollX - 100,
      clientY: 100 - maximumScrollY - 100,
    }),
  );
  await waitForAttribute(viewport, 'data-icon-last-visible-index', '1401');
  await waitForGreaterAttribute(viewport, 'data-icon-recycle-count', recycleCount);
  await waitForAttribute(viewport, 'data-icon-scroll-x', String(maximumScrollX));
  await waitForAttribute(viewport, 'data-icon-scroll-y', String(maximumScrollY));
  if (numericAttribute(viewport, 'data-icon-assigned-count') <= 0) {
    throw new Error(`${techniqueLabel(technique)} recycled every icon tile out of view`);
  }
  canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await waitForAttribute(viewport, 'data-icon-first-visible-index', '0');
  await waitForAttribute(viewport, 'data-icon-scroll-x', '0');
  await waitForAttribute(viewport, 'data-icon-scroll-y', '0');
}

await clickButton('MSDF', true);
await clickButton('Paragraph stress', false);
await waitForReadyViewport('mtsdf', 'paragraph-stress');
const fontSwitchContinuity = monitorLivePresentationContinuity();
let paragraphStressTextLength: number | undefined;
for (const fixture of [
  { button: 'Inter Regular', id: 'inter' },
  { button: 'Source Serif 4', id: 'source-serif-4' },
  { button: 'Dancing Script', id: 'dancing-script' },
] as const) {
  await clickButton(fixture.button, false);
  const viewport = await waitForRenderedFixture('mtsdf', 'paragraph-stress', fixture.id);
  const sourceTextLength = numericAttribute(viewport, 'data-source-text-length');
  paragraphStressTextLength ??= sourceTextLength;
  if (sourceTextLength !== paragraphStressTextLength) {
    throw new Error(`${fixture.id} changed the Paragraph Stress source text`);
  }
}
fontSwitchContinuity.assertContinuous();
console.log('font-fixture-corpus-ready', paragraphStressTextLength);

await clickButton('Inter Regular', false);
await clickButton('Paint & effects', false);
const activePaintViewport = await waitForReadyViewport('mtsdf', 'paint-effects');
await clickButton('conformance', true);
const benchmarkActivity = await waitForActivityVisibility('benchmark', false);
const hiddenPaintRevision = numericAttribute(activePaintViewport, 'data-paint-revision');
await waitForConformanceCapture();
if (numericAttribute(activePaintViewport, 'data-paint-revision') !== hiddenPaintRevision) {
  throw new Error('Hidden Benchmark Activity continued its paint animation loop');
}
await clickButton('benchmark', true);
await waitForActivityVisibility('benchmark', true);
const resumedPaintViewport = await waitForReadyViewport('mtsdf', 'paint-effects');
await waitForGreaterAttribute(
  resumedPaintViewport,
  'data-paint-revision',
  numericAttribute(resumedPaintViewport, 'data-paint-revision'),
);
if (getComputedStyle(benchmarkActivity).display === 'none') {
  throw new Error('Benchmark Activity did not become visible after resuming');
}
console.log('activity-lifecycle-ready');

console.log('comparison-workloads-ready', JSON.stringify({ techniques: 3, workloads: 7 }));

function monitorLivePresentationContinuity(): { assertContinuous(): void } {
  const surface = document.querySelector<HTMLElement>('[data-testid="benchmark-surface"]');
  if (surface === null) throw new Error('Benchmark surface is unavailable for continuity checks');
  const labels = ['CPU frame ms history', 'FPS history', 'GPU frame ms history'] as const;
  const canvases = labels.map((label) => document.querySelector<HTMLCanvasElement>(`canvas[aria-label="${label}"]`));
  if (canvases.some((canvas) => canvas === null)) {
    throw new Error('Benchmark graph canvas is unavailable for continuity checks');
  }
  let emptyMetricTransitions = 0;
  let loadingOverlayTransitions = 0;
  let replacedCanvases = 0;
  const observer = new MutationObserver(() => {
    if (liveMetricValue('CPU frame submit') === '—') emptyMetricTransitions += 1;
    if (surface.textContent?.includes('LOADING MSDF')) loadingOverlayTransitions += 1;
    for (let index = 0; index < labels.length; index += 1) {
      const current = document.querySelector<HTMLCanvasElement>(`canvas[aria-label="${labels[index]}"]`);
      if (current !== canvases[index]) replacedCanvases += 1;
    }
  });
  observer.observe(surface, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
  return {
    assertContinuous() {
      observer.disconnect();
      if (emptyMetricTransitions !== 0) {
        throw new Error(`Font switching emptied live metrics ${emptyMetricTransitions} times`);
      }
      if (loadingOverlayTransitions !== 0) {
        throw new Error(`Font switching restored the loading overlay ${loadingOverlayTransitions} times`);
      }
      if (replacedCanvases !== 0) {
        throw new Error(`Font switching replaced graph canvases ${replacedCanvases} times`);
      }
    },
  };
}

function liveMetricValue(label: string): string | undefined {
  const labelNode = [...document.querySelectorAll<HTMLElement>('div')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  return labelNode?.nextElementSibling?.textContent?.trim();
}

function techniqueLabel(technique: RasterTechnique): 'Bitmap' | 'MSDF' | 'Slug' {
  return technique === 'mtsdf' ? 'MSDF' : technique === 'slug' ? 'Slug' : 'Bitmap';
}

function effectControlLabel(effect: 'Shadow' | 'Stroke width', technique: RasterTechnique): string {
  if (technique === 'mtsdf') return effect;
  return `${effect} · unavailable for ${technique === 'slug' ? 'Slug V0' : 'bitmap'}`;
}

async function clickButton(label: string, exact: boolean): Promise<void> {
  const find = (): HTMLButtonElement | undefined =>
    [...document.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => {
      const content = candidate.textContent?.trim() ?? '';
      return !candidate.disabled && (exact ? content === label : content.includes(label));
    });
  const button = find() ?? (await observeDocument(find));
  button.click();
}

function rangeControl(label: string): HTMLInputElement {
  const control = [...document.querySelectorAll<HTMLInputElement>('input[type="range"]')].find(
    (candidate) => candidate.labels?.[0]?.textContent?.includes(label) === true,
  );
  if (control === undefined) throw new Error(`${label} range control is unavailable`);
  return control;
}

function assertRangeVisualTravel(control: HTMLInputElement): void {
  const style = getComputedStyle(control);
  const shell = control.parentElement;
  if (shell === null || !shell.classList.contains('range-shell')) {
    throw new Error('Range control is missing its filled-track surface');
  }
  if (style.paddingLeft !== '0px' || style.paddingRight !== '0px') {
    throw new Error('Range control retains padding that creates false endpoint space');
  }
  if (style.getPropertyValue('--range-track-inset').trim() !== '7px') {
    throw new Error('Range control does not align its visible track with the thumb-center travel');
  }
  const progress = Number(getComputedStyle(shell).getPropertyValue('--range-progress'));
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new Error('Range control fill does not represent its current value');
  }
  if (getComputedStyle(shell, '::before').backgroundColor === 'rgba(0, 0, 0, 0)') {
    throw new Error('Range control has no visible neutral rail');
  }
  if (getComputedStyle(shell, '::after').backgroundColor === 'rgba(0, 0, 0, 0)') {
    throw new Error('Range control has no visible value fill');
  }
}

function setRange(label: string, value: number): void {
  const control = rangeControl(label);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('Native input value setter is unavailable');
  setter.call(control, String(value));
  control.dispatchEvent(new Event('input', { bubbles: true }));
}

function setDifferentRange(label: string, preferred: number): number {
  const control = rangeControl(label);
  const current = control.valueAsNumber;
  const alternative = preferred < Number(control.max) ? preferred + 1 : preferred - 1;
  const value = current === preferred ? alternative : preferred;
  setRange(label, value);
  return value;
}

function setCheckbox(label: string, checked: boolean): void {
  const control = checkboxControl(label);
  if (control.checked !== checked) control.click();
}

function setPressedButton(label: string, pressed: boolean): void {
  const control = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (control === null) throw new Error(`${label} button is unavailable`);
  if ((control.getAttribute('aria-pressed') === 'true') !== pressed) control.click();
}

function checkboxControl(label: string): HTMLInputElement {
  const control = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
    (candidate) => candidate.getAttribute('aria-label') === label,
  );
  if (control === undefined) throw new Error(`${label} checkbox is unavailable`);
  return control;
}

function waitForActivityVisibility(name: string, visible: boolean): Promise<HTMLElement> {
  const find = (): HTMLElement | undefined => {
    const activity = document.querySelector<HTMLElement>(`[data-activity="${name}"]`);
    if (activity === null) return undefined;
    return (getComputedStyle(activity).display !== 'none') === visible ? activity : undefined;
  };
  const current = find();
  return current === undefined ? observeDocument(find) : Promise.resolve(current);
}

function waitForConformanceCapture(): Promise<HTMLElement> {
  const find = (): HTMLElement | undefined =>
    document.querySelector<HTMLElement>('[data-testid="conformance-surface"][data-conformance-ready="true"]') ??
    undefined;
  const current = find();
  return current === undefined ? observeDocument(find) : Promise.resolve(current);
}

function readyViewport(technique: RasterTechnique, workload: string): HTMLElement | undefined {
  const viewport = document.querySelector<HTMLElement>('[data-testid="comparison-live-viewport"]');
  if (
    viewport === null ||
    viewport.getAttribute('data-technique') !== technique ||
    viewport.getAttribute('data-workload') !== workload ||
    viewport.getAttribute('data-missing-glyph-count') !== '0' ||
    positiveAttribute(viewport, 'data-glyph-count') === false ||
    positiveAttribute(viewport, 'data-draw-count') === false ||
    positiveAttribute(viewport, 'data-submit-history-length') === false
  ) {
    return undefined;
  }
  const gpuTiming = viewport.getAttribute('data-gpu-timing-supported');
  if (gpuTiming !== 'true' && gpuTiming !== 'false') return undefined;
  return viewport;
}

function waitForReadyViewport(technique: RasterTechnique, workload: string): Promise<HTMLElement> {
  const current = readyViewport(technique, workload);
  if (current !== undefined) return Promise.resolve(current);
  return observeDocument(() => readyViewport(technique, workload));
}

function waitForRenderedFixture(
  technique: RasterTechnique,
  workload: string,
  fontFixture: string,
): Promise<HTMLElement> {
  const find = (): HTMLElement | undefined => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="comparison-live-viewport"]');
    if (
      viewport === null ||
      viewport.getAttribute('data-technique') !== technique ||
      viewport.getAttribute('data-workload') !== workload ||
      viewport.getAttribute('data-font-fixture') !== fontFixture ||
      positiveAttribute(viewport, 'data-glyph-count') === false ||
      positiveAttribute(viewport, 'data-draw-count') === false ||
      positiveAttribute(viewport, 'data-source-text-length') === false
    ) {
      return undefined;
    }
    return viewport;
  };
  const current = find();
  return current === undefined ? observeDocument(find) : Promise.resolve(current);
}

function waitForViewportAttribute(
  technique: RasterTechnique,
  workload: string,
  name: string,
  value: string,
): Promise<HTMLElement> {
  const find = (): HTMLElement | undefined => {
    const viewport = readyViewport(technique, workload);
    return viewport?.getAttribute(name) === value ? viewport : undefined;
  };
  const current = find();
  return current === undefined ? observeDocument(find) : Promise.resolve(current);
}

function waitForAttribute(element: HTMLElement, name: string, value: string): Promise<void> {
  if (element.getAttribute(name) === value) return Promise.resolve();
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (element.getAttribute(name) !== value) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(element, { attributes: true, attributeFilter: [name] });
  });
}

function waitForGreaterAttribute(element: HTMLElement, name: string, previous: number): Promise<void> {
  if (numericAttribute(element, name) > previous) return Promise.resolve();
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (numericAttribute(element, name) <= previous) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(element, { attributes: true, attributeFilter: [name] });
  });
}

function observeDocument<Element extends HTMLElement>(find: () => Element | undefined): Promise<Element> {
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const value = find();
      if (value === undefined) return;
      observer.disconnect();
      resolve(value);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
    });
  });
}

function positiveAttribute(element: HTMLElement, name: string): boolean {
  const value = Number(element.getAttribute(name));
  return Number.isFinite(value) && value > 0;
}

function numericAttribute(element: HTMLElement, name: string): number {
  const value = Number(element.getAttribute(name));
  if (!Number.isFinite(value)) throw new Error(`${name} is not a finite renderer measurement`);
  return value;
}

export {};
