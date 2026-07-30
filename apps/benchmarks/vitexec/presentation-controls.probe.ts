export {};

function waitFor<T>(find: () => T | undefined, timeoutMs = 20_000): Promise<T> {
  const current = find();
  if (current !== undefined) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error('Timed out waiting for Presentation control state'));
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

const viewport = await waitFor(() => {
  const candidate = document.querySelector<HTMLElement>(
    '[data-testid="comparison-live-viewport"][data-technique="mtsdf"][data-workload="icon-grid"]',
  );
  return candidate?.getAttribute('data-presentation-pending') === 'false' ? candidate : undefined;
});
console.log('presentation-controls-viewport-ready');
const sizeTrigger = await waitFor(() =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
    button.getAttribute('aria-label')?.startsWith('Icon size:'),
  ),
);
console.log('presentation-controls-trigger-ready', sizeTrigger.getAttribute('aria-label'));
sizeTrigger.click();
const sliderRoot = await waitFor(() => {
  const candidate = document.querySelector<HTMLElement>('[data-slot="slider"][aria-label="Icon size"]');
  return candidate ?? undefined;
});
const slider = sliderRoot.querySelector<HTMLInputElement>('input[type="range"]');
if (slider === null) throw new Error(`Icon size slider is missing its range input: ${sliderRoot.outerHTML}`);
console.log('presentation-controls-slider-ready', slider.value);
const before = viewport.getAttribute('data-rendered-device-px');
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
if (setter === undefined) throw new Error('Native range value setter is unavailable');
setter.call(slider, '0.8');
slider.dispatchEvent(new Event('input', { bubbles: true }));
slider.dispatchEvent(new Event('change', { bubbles: true }));
const after = await waitFor(() => {
  const value = viewport.getAttribute('data-rendered-device-px');
  return value !== before ? (value ?? undefined) : undefined;
});
console.log('presentation-controls-slider-updated', before, after);
document.querySelector<HTMLElement>('[data-testid="comparison-live-viewport"]')?.click();
await waitFor(() => (sizeTrigger.getAttribute('aria-expanded') === 'false' ? true : undefined));

const workloadTrigger = document.querySelector<HTMLButtonElement>('button[aria-label="Live workload"]');
if (workloadTrigger?.textContent?.includes('Icon grid') !== true) {
  throw new Error(
    `Presentation workload trigger rendered its key instead of its label: ${workloadTrigger?.textContent ?? 'missing'}`,
  );
}

workloadTrigger.click();
const offAxisOption = await waitFor(() =>
  [...document.querySelectorAll<HTMLElement>('[data-slot="select-item"]')].find((item) =>
    item.textContent?.includes('Off-axis / 3D'),
  ),
);
offAxisOption.click();
const offAxisViewport = await waitFor(() => {
  const candidate = document.querySelector<HTMLElement>(
    '[data-testid="comparison-live-viewport"][data-workload="off-axis-3d"]',
  );
  return candidate?.getAttribute('data-presentation-pending') === 'false' ? candidate : undefined;
});
if (offAxisViewport.getAttribute('data-missing-glyph-count') !== '0') {
  throw new Error(
    `Off-axis technical specimen contains ${offAxisViewport.getAttribute('data-missing-glyph-count') ?? 'unknown'} missing glyphs`,
  );
}
const layoutWidthTrigger = await waitFor(() =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.getAttribute('aria-label') === 'Layout width: 100%',
  ),
);
layoutWidthTrigger.click();
const layoutWidthSlider = await waitFor(() => {
  const candidate = document.querySelector<HTMLElement>('[data-slot="slider"][aria-label="Layout width"]');
  return candidate?.querySelector<HTMLInputElement>('input[type="range"]') ?? undefined;
});
if (layoutWidthSlider.max !== '200') {
  throw new Error(`Off-axis layout width maximum is ${layoutWidthSlider.max}, expected 200`);
}

console.log(
  'presentation-controls-ready',
  JSON.stringify({ before, after, outsideDismissed: true, label: 'Icon grid', offAxisWidth: '100–200%' }),
);
