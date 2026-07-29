type Technique = 'bitmap' | 'mtsdf' | 'slug';

interface IconAssignment {
  readonly index: number;
  readonly content: string;
}

export {};

const techniqueLabels: Readonly<Record<Technique, string>> = {
  bitmap: 'Bitmap',
  mtsdf: 'MSDF',
  slug: 'Slug',
};
const catalogResponse = await fetch('/fixtures/fonts/font-awesome-free-6.7.2/icons.json');
if (!catalogResponse.ok) throw new Error('Icon-grid evidence could not load its pinned catalog');
const catalogBytes = new Uint8Array(await catalogResponse.arrayBuffer());
const fontAwesomeIcons = readCatalog(JSON.parse(new TextDecoder().decode(catalogBytes)));
const catalog = fontAwesomeIcons.icons;
const expectedContent = catalog.map(({ codePoint, name }) => `${String.fromCodePoint(codePoint)}\n${name}`);
const environmentPath = '/src/benchmark/environment.ts';
const cases: Array<Record<string, unknown>> = [];

for (const technique of ['bitmap', 'mtsdf', 'slug'] as const) {
  if (technique !== 'bitmap') await selectTechnique(technique);
  const viewport = await readyViewport(technique);
  assertCatalogContract(viewport, technique);
  const canvas = viewport.querySelector<HTMLCanvasElement>('canvas[data-pan-enabled="true"]');
  if (canvas === null) throw new Error(`${technique} canvas is unavailable`);

  const maximumScrollX = numberAttribute(viewport, 'data-icon-maximum-scroll-x');
  const maximumScrollY = numberAttribute(viewport, 'data-icon-maximum-scroll-y');
  const viewportWidth = numberAttribute(viewport, 'data-icon-grid-width') - maximumScrollX;
  const viewportHeight = numberAttribute(viewport, 'data-icon-grid-height') - maximumScrollY;
  if (maximumScrollX <= 0 || maximumScrollY <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    throw new Error(`${technique} grid is not two-dimensionally pannable`);
  }

  const xStops = traversalStops(maximumScrollX, viewportWidth * 0.75);
  const yStops = traversalStops(maximumScrollY, viewportHeight * 0.75);
  const observedIndices = new Set<number>();
  const observedSignatures = new Set<string>();
  let minimumPoolCapacity = Number.POSITIVE_INFINITY;
  let maximumPoolCapacity = 0;
  let windowsVisited = 0;
  let currentX = numberAttribute(viewport, 'data-icon-scroll-x');
  let currentY = numberAttribute(viewport, 'data-icon-scroll-y');
  const initialRevision = numberAttribute(viewport, 'data-icon-window-revision');

  for (const [rowIndex, targetY] of yStops.entries()) {
    const rowStops = rowIndex % 2 === 0 ? xStops : xStops.toReversed();
    for (const targetX of rowStops) {
      const previousRevision = numberAttribute(viewport, 'data-icon-window-revision');
      panCanvas(canvas, currentX - targetX, currentY - targetY);
      await waitForSettledWindow(viewport, previousRevision, targetX, targetY);
      currentX = targetX;
      currentY = targetY;
      const assignments = readAndValidateAssignments(viewport, technique);
      for (const { index } of assignments) observedIndices.add(index);
      observedSignatures.add(requiredAttribute(viewport, 'data-icon-assignment-signature'));
      const poolCapacity = numberAttribute(viewport, 'data-icon-pool-capacity');
      minimumPoolCapacity = Math.min(minimumPoolCapacity, poolCapacity);
      maximumPoolCapacity = Math.max(maximumPoolCapacity, poolCapacity);
      windowsVisited += 1;
    }
  }

  let previousRevision = numberAttribute(viewport, 'data-icon-window-revision');
  panCanvas(canvas, currentX - maximumScrollX, currentY - maximumScrollY);
  await waitForSettledWindow(viewport, previousRevision, maximumScrollX, maximumScrollY);
  const finalAssignments = readAndValidateAssignments(viewport, technique);
  if (
    observedIndices.size !== catalog.length ||
    [...observedIndices].some((index) => index < 0 || index >= catalog.length)
  ) {
    throw new Error(
      `${technique} traversal observed ${String(observedIndices.size)} of ${String(catalog.length)} catalog assignments`,
    );
  }
  assertZeroMissingGlyphs(viewport, `${technique} final window`);
  const finalRevision = numberAttribute(viewport, 'data-icon-window-revision');
  const finalMissingGlyphCount = numberAttribute(viewport, 'data-missing-glyph-count');

  previousRevision = finalRevision;
  canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await waitForSettledWindow(viewport, previousRevision, 0, 0);
  const resetAssignments = readAndValidateAssignments(viewport, technique);
  assertZeroMissingGlyphs(viewport, `${technique} reset window`);
  const resetMissingGlyphCount = numberAttribute(viewport, 'data-missing-glyph-count');

  cases.push({
    technique,
    traversal: 'two-axis-serpentine-75-percent-viewport-stride',
    horizontalStops: xStops.length,
    verticalStops: yStops.length,
    windowsVisited,
    uniqueWindowSignatures: observedSignatures.size,
    observedAssignmentCount: observedIndices.size,
    initialRevision,
    finalRevision,
    resetRevision: numberAttribute(viewport, 'data-icon-window-revision'),
    minimumPoolCapacity,
    maximumPoolCapacity,
    maximumScrollX,
    maximumScrollY,
    finalAssignedCount: finalAssignments.length,
    finalMissingGlyphCount,
    resetAssignedCount: resetAssignments.length,
    resetMissingGlyphCount,
  });
  console.log(
    'icon-grid-technique-ready',
    JSON.stringify({ technique, windowsVisited, observedAssignmentCount: observedIndices.size }),
  );
}

const [environmentModule, fontResponse, gpuAdapter] = await Promise.all([
  import(/* @vite-ignore */ environmentPath),
  fetch('/fixtures/fonts/font-awesome-free-6.7.2/fa-solid-900.ttf'),
  navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' }),
]);
if (!fontResponse.ok) throw new Error('Icon-grid evidence could not authenticate its pinned font');
const gpuAdapterInfo = gpuAdapter?.info;
console.log(
  'icon-grid-retained-evidence-ready',
  JSON.stringify({
    schemaVersion: 0,
    kind: 'icon-grid-retained-evidence',
    capturedAt: new Date().toISOString(),
    authority: 'causal-window-revision-and-exact-assignment-signature',
    environment: await environmentModule.environmentResource(),
    browser: navigator.userAgent,
    gpuAdapter:
      gpuAdapterInfo === undefined
        ? undefined
        : {
            architecture: gpuAdapterInfo.architecture,
            description: gpuAdapterInfo.description,
            device: gpuAdapterInfo.device,
            vendor: gpuAdapterInfo.vendor,
          },
    provenance: {
      catalogPath: 'apps/benchmarks/fixtures/fonts/font-awesome-free-6.7.2/icons.json',
      catalogFixtureSha256: await sha256(catalogBytes),
      catalogSourceUrl: fontAwesomeIcons.source.url,
      catalogSourceSha256: fontAwesomeIcons.source.sha256,
      catalogVersion: fontAwesomeIcons.source.version,
      fontPath: 'apps/benchmarks/fixtures/fonts/font-awesome-free-6.7.2/fa-solid-900.ttf',
      fontSha256: await sha256(new Uint8Array(await fontResponse.arrayBuffer())),
      assignmentCatalogSha256: await sha256(new TextEncoder().encode(JSON.stringify(expectedContent))),
    },
    catalogItemCount: catalog.length,
    cases,
  }),
);

function assertCatalogContract(viewport: HTMLElement, technique: Technique): void {
  if (
    numberAttribute(viewport, 'data-icon-item-count') !== catalog.length ||
    numberAttribute(viewport, 'data-icon-label-count') !== catalog.length ||
    numberAttribute(viewport, 'data-icon-column-count') !== 38 ||
    numberAttribute(viewport, 'data-icon-row-count') !== 37 ||
    numberAttribute(viewport, 'data-icon-label-size') !== 11 ||
    numberAttribute(viewport, 'data-icon-first-visible-index') !== 0
  ) {
    throw new Error(`${technique} icon catalog contract is invalid`);
  }
  const poolCapacity = numberAttribute(viewport, 'data-icon-pool-capacity');
  if (poolCapacity <= 0 || poolCapacity >= catalog.length) {
    throw new Error(`${technique} icon pool is not virtualized`);
  }
}

function readCatalog(candidate: unknown): {
  readonly source: { readonly version: string; readonly url: string; readonly sha256: string };
  readonly icons: readonly { readonly name: string; readonly codePoint: number }[];
} {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new TypeError('Font Awesome catalog must be an object');
  }
  const source = Reflect.get(candidate, 'source');
  const icons = Reflect.get(candidate, 'icons');
  const sourceVersion = typeof source === 'object' && source !== null ? Reflect.get(source, 'version') : undefined;
  const sourceUrl = typeof source === 'object' && source !== null ? Reflect.get(source, 'url') : undefined;
  const sourceSha256 = typeof source === 'object' && source !== null ? Reflect.get(source, 'sha256') : undefined;
  if (
    typeof source !== 'object' ||
    source === null ||
    Array.isArray(source) ||
    typeof sourceVersion !== 'string' ||
    typeof sourceUrl !== 'string' ||
    typeof sourceSha256 !== 'string' ||
    !Array.isArray(icons)
  ) {
    throw new TypeError('Font Awesome catalog has invalid source metadata');
  }
  const normalizedIcons = icons.map((icon, index) => {
    if (typeof icon !== 'object' || icon === null || Array.isArray(icon)) {
      throw new TypeError(`Font Awesome catalog icon ${String(index)} must be an object`);
    }
    const name = Reflect.get(icon, 'name');
    const codePoint = Reflect.get(icon, 'codePoint');
    if (typeof name !== 'string' || typeof codePoint !== 'number' || !Number.isSafeInteger(codePoint)) {
      throw new TypeError(`Font Awesome catalog icon ${String(index)} is invalid`);
    }
    return { name, codePoint };
  });
  return {
    source: {
      version: sourceVersion,
      url: sourceUrl,
      sha256: sourceSha256,
    },
    icons: normalizedIcons,
  };
}

function readAndValidateAssignments(viewport: HTMLElement, technique: Technique): readonly IconAssignment[] {
  const value: unknown = JSON.parse(requiredAttribute(viewport, 'data-icon-assignment-signature'));
  if (!Array.isArray(value)) throw new TypeError(`${technique} assignment signature is not an array`);
  const assignments: IconAssignment[] = [];
  let previousIndex = -1;
  for (const candidate of value) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      throw new TypeError(`${technique} assignment signature contains a non-object`);
    }
    const index = Reflect.get(candidate, 'index');
    const content = Reflect.get(candidate, 'content');
    if (
      typeof index !== 'number' ||
      !Number.isSafeInteger(index) ||
      index <= previousIndex ||
      typeof content !== 'string' ||
      content !== expectedContent[index]
    ) {
      throw new Error(`${technique} assignment does not match pinned catalog index ${String(index)}`);
    }
    assignments.push({ index, content });
    previousIndex = index;
  }
  if (assignments.length !== numberAttribute(viewport, 'data-icon-assigned-count')) {
    throw new Error(`${technique} assignment signature and visible pool count disagree`);
  }
  assertZeroMissingGlyphs(viewport, `${technique} settled window`);
  return assignments;
}

async function selectTechnique(technique: Technique): Promise<void> {
  const button = await observeDocument(() =>
    [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) =>
        candidate.textContent?.trim().startsWith(techniqueLabels[technique]) === true && !candidate.disabled,
    ),
  );
  button.click();
}

function readyViewport(technique: Technique): Promise<HTMLElement> {
  return observeDocument(() => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="comparison-live-viewport"]');
    return viewport?.getAttribute('data-workload') === 'icon-grid' &&
      viewport.getAttribute('data-technique') === technique &&
      numberAttributeOrUndefined(viewport, 'data-icon-window-revision') !== undefined &&
      numberAttributeOrUndefined(viewport, 'data-missing-glyph-count') === 0
      ? viewport
      : undefined;
  });
}

function waitForSettledWindow(
  viewport: HTMLElement,
  previousRevision: number,
  scrollX: number,
  scrollY: number,
): Promise<void> {
  return observeElement(viewport, () => {
    const revision = numberAttributeOrUndefined(viewport, 'data-icon-window-revision');
    return revision !== undefined &&
      revision > previousRevision &&
      numberAttributeOrUndefined(viewport, 'data-icon-scroll-x') === scrollX &&
      numberAttributeOrUndefined(viewport, 'data-icon-scroll-y') === scrollY
      ? true
      : undefined;
  }).then(() => undefined);
}

function panCanvas(canvas: HTMLCanvasElement, deltaX: number, deltaY: number): void {
  const pointerId = 71;
  canvas.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      pointerId,
      pointerType: 'mouse',
      clientX: 0,
      clientY: 0,
    }),
  );
  canvas.dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      button: 0,
      pointerId,
      pointerType: 'mouse',
      clientX: deltaX,
      clientY: deltaY,
    }),
  );
  canvas.dispatchEvent(
    new PointerEvent('pointerup', {
      bubbles: true,
      button: 0,
      pointerId,
      pointerType: 'mouse',
      clientX: deltaX,
      clientY: deltaY,
    }),
  );
}

function traversalStops(maximum: number, stride: number): readonly number[] {
  const stops = [0];
  for (let position = stride; position < maximum; position += stride) stops.push(position);
  if (maximum > 0) stops.push(maximum);
  return stops;
}

function assertZeroMissingGlyphs(viewport: HTMLElement, label: string): void {
  if (numberAttribute(viewport, 'data-missing-glyph-count') !== 0) {
    throw new Error(`${label} contains missing glyphs`);
  }
}

function observeDocument<Element extends HTMLElement>(find: () => Element | undefined): Promise<Element> {
  const current = find();
  if (current !== undefined) return Promise.resolve(current);
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const value = find();
      if (value === undefined) return;
      observer.disconnect();
      resolve(value);
    });
    observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true });
  });
}

function observeElement<Value>(element: HTMLElement, find: () => Value | undefined): Promise<Value> {
  const current = find();
  if (current !== undefined) return Promise.resolve(current);
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const value = find();
      if (value === undefined) return;
      observer.disconnect();
      resolve(value);
    });
    observer.observe(element, { attributes: true });
  });
}

function requiredAttribute(element: HTMLElement, name: string): string {
  const value = element.getAttribute(name);
  if (value === null) throw new Error(`${name} is unavailable`);
  return value;
}

function numberAttribute(element: HTMLElement, name: string): number {
  const value = numberAttributeOrUndefined(element, name);
  if (value === undefined) throw new Error(`${name} is not finite`);
  return value;
}

function numberAttributeOrUndefined(element: HTMLElement, name: string): number | undefined {
  const source = element.getAttribute(name);
  if (source === null) return undefined;
  const value = Number(source);
  return Number.isFinite(value) ? value : undefined;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
