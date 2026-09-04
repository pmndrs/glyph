export {};

type RasterFormatName = 'bitmap' | 'mtsdf' | 'slug';

const labels: Readonly<Record<RasterFormatName, string>> = {
  bitmap: 'Bitmap',
  mtsdf: 'MSDF',
  slug: 'Slug',
};

function visible<T extends HTMLElement>(elements: Iterable<T>): T | undefined {
  return [...elements].find((element) => element.offsetParent !== null);
}

function waitFor<T>(read: () => T | undefined, timeoutMs = 60_000): Promise<T> {
  const current = read();
  if (current !== undefined) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timed out waiting for the raster-format switch: ${location.href}`));
    }, timeoutMs);
    const observer = new MutationObserver(() => {
      const value = read();
      if (value === undefined) return;
      clearTimeout(timeout);
      observer.disconnect();
      resolve(value);
    });
    observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true });
  });
}

async function switchFormat(format: RasterFormatName): Promise<Record<string, number | string>> {
  const button = visible(
    [...document.querySelectorAll<HTMLButtonElement>('button')].filter(
      (candidate) => candidate.textContent?.trim() === labels[format],
    ),
  );
  if (button === undefined) throw new Error(`Missing ${labels[format]} raster-format button`);
  const startedAt = performance.now();
  button.click();
  const viewport = await waitFor(() => {
    const candidate = visible(document.querySelectorAll<HTMLElement>('[data-testid="comparison-live-viewport"]'));
    if (
      candidate?.getAttribute('data-technique') !== format ||
      candidate.getAttribute('data-presentation-pending') !== 'false' ||
      Number(candidate.getAttribute('data-glyph-count')) <= 0 ||
      Number(candidate.getAttribute('data-draw-count')) <= 0
    ) {
      return undefined;
    }
    return candidate;
  });
  const finishedAt = performance.now();
  return {
    technique: format,
    elapsedMs: Number((finishedAt - startedAt).toFixed(2)),
    draws: Number(viewport.getAttribute('data-draw-count')),
    glyphs: Number(viewport.getAttribute('data-glyph-count')),
  };
}

await waitFor(() => {
  const viewport = visible(document.querySelectorAll<HTMLElement>('[data-testid="comparison-live-viewport"]'));
  return viewport?.getAttribute('data-presentation-pending') === 'false' ? viewport : undefined;
});

performance.clearResourceTimings();
const results = [];
for (const format of ['bitmap', 'mtsdf', 'slug', 'mtsdf', 'bitmap', 'mtsdf'] as const) {
  results.push(await switchFormat(format));
}
const fontRequests = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).filter(({ name }) =>
  /(?:\.font\.glb|\.font\.glb\.gz|\.(?:otf|ttf))$/u.test(new URL(name).pathname),
);
const requestCounts = new Map<string, number>();
let transferredBytes = 0;
for (const { name, transferSize } of fontRequests) {
  const pathname = new URL(name).pathname;
  requestCounts.set(pathname, (requestCounts.get(pathname) ?? 0) + 1);
  transferredBytes += transferSize;
}

console.log(
  'presentation-technique-switch-ready',
  JSON.stringify({
    fontRequests: {
      count: fontRequests.length,
      transferredBytes,
      byUrl: Object.fromEntries(requestCounts),
    },
    results,
  }),
);

/* @workflow { "name": "benchmark:technique-switch", "summary": "Measure repeated Presentation technique switches and report font transport reuse.", "requirements": "Running benchmark server, GPU-enabled Chromium, and Vitexec.", "writes": "Standard output only.", "args": ["--gpu", "--path", "/presentation?mode=benchmark&technique=slug&backend=webgpu&delivery=baked&dpr=2&font=inter&workload=paragraph-stress"] } */
