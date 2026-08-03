import type {
  ComparisonWorkloadPreview,
  ComparisonWorkloadStats,
} from '../src/benchmark/targets/measurement/comparison-preview';

export {};

type SlugComparisonWorkloadStats = Extract<ComparisonWorkloadStats, { readonly technique: 'slug' }>;

const comparisonWorkloadPath = '/src/benchmark/targets/measurement/comparison-preview.ts';
const environmentPath = '/src/benchmark/environment.ts';
const fontFixturesPath = '/src/benchmark/font-fixtures.ts';
const productResultPath = '/src/benchmark/product-result.ts';
const STEADY_STATE_REPORT_COUNT = 12;
const VIEWPORT_WIDTH = 1500;
const VIEWPORT_HEIGHT = 950;
const WORKLOAD = 'text-ladder';
const [{ createComparisonWorkloadPreview }, { environmentResource }, fontFixtures, productResult] = await Promise.all([
  import(/* @vite-ignore */ comparisonWorkloadPath),
  import(/* @vite-ignore */ environmentPath),
  import(/* @vite-ignore */ fontFixturesPath),
  import(/* @vite-ignore */ productResultPath),
]);

const cases: Array<Record<string, unknown>> = [];
for (const backend of ['webgpu', 'webgl2'] as const) {
  for (const dpr of [1, 2] as const) {
    for (const fontFixture of fontFixtures.ADVANCED_FONT_FIXTURES) {
      const id = `${backend}-${dpr}x-${fontFixture.id}`;
      const specimen = fontFixtures.rasterConformanceSpecimen(fontFixture.id);
      console.log('slug-performance-matrix-start', id);
      const canvas = document.createElement('canvas');
      canvas.dataset.slugPerformanceMatrixCase = id;
      document.body.append(canvas);
      let preview: ComparisonWorkloadPreview | undefined;
      try {
        let settled = false;
        let resolveResult: (result: Record<string, unknown>) => void = () => undefined;
        let rejectResult: (error: unknown) => void = () => undefined;
        const result = new Promise<Record<string, unknown>>((resolve, reject) => {
          resolveResult = resolve;
          rejectResult = reject;
        });
        const fail = (error: unknown): void => {
          if (settled) return;
          settled = true;
          rejectResult(error);
        };
        preview = await createComparisonWorkloadPreview({
          amount: 50,
          animationEnabled: false,
          animationSpeed: 50,
          backend,
          canvas,
          delivery: 'baked',
          dpr,
          fontFixture: fontFixture.id,
          fontSize: 16,
          height: VIEWPORT_HEIGHT,
          layoutWidthRatio: 0.72,
          paintOpacity: 1,
          paintShadowEnabled: false,
          paintStrokeWidth: 0,
          showGrid: false,
          showLayoutBounds: false,
          technique: 'slug',
          textLadderSpecimen: specimen,
          width: VIEWPORT_WIDTH,
          workload: WORKLOAD,
          onError: fail,
          onStats: (stats: ComparisonWorkloadStats) => {
            if (settled) return;
            try {
              assertCaseStats(stats, backend, dpr);
              if (
                stats.fpsHistoryCursor.length < STEADY_STATE_REPORT_COUNT ||
                stats.gpuHistoryCursor.length < STEADY_STATE_REPORT_COUNT
              ) {
                return;
              }
              settled = true;
              resolveResult({
                id,
                fontFixture: fontFixture.id,
                fontLabel: fontFixture.label,
                fontMetadata: fontFixture.metadata,
                backend,
                dpr,
                specimen,
                stats: productResult.captureLiveTextStats(stats),
              });
            } catch (error) {
              fail(error);
            }
          },
        });
        cases.push(await result);
      } finally {
        await preview?.dispose();
        canvas.remove();
      }
      console.log('slug-performance-matrix-complete', id);
    }
  }
}

const gpuAdapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
const gpuAdapterInfo = gpuAdapter?.info;
console.log(
  'slug-performance-matrix-ready',
  JSON.stringify({
    schemaVersion: 0,
    kind: 'slug-performance-matrix-observation',
    capturedAt: new Date().toISOString(),
    technique: 'slug',
    delivery: 'baked',
    workload: WORKLOAD,
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
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

function assertCaseStats(
  stats: ComparisonWorkloadStats,
  backend: 'webgpu' | 'webgl2',
  dpr: 1 | 2,
): asserts stats is SlugComparisonWorkloadStats {
  if (stats.technique !== 'slug' || stats.backend !== backend || stats.dpr !== dpr || stats.workload !== WORKLOAD) {
    throw new Error(`${backend} ${dpr}x Slug preview did not preserve its requested configuration`);
  }
  if (stats.gpuTimingSupported !== true) {
    throw new Error(`${backend} ${dpr}x Slug preview did not expose GPU timestamp queries`);
  }
  for (const name of [
    'rendererInitMs',
    'fontLoadMs',
    'textReadyMs',
    'firstDrawMs',
    'uploadFrameGpuMs',
    'uploadFrameCompleteMs',
    'startupMs',
    'glyphCount',
    'missingGlyphCount',
    'drawCount',
    'artifactBytes',
    'slugCurveGpuBytes',
    'slugHeaderGpuBytes',
    'slugReferenceGpuBytes',
    'slugGpuBytes',
    'framebufferGpuBytes',
    'totalGpuBytes',
  ] as const) {
    const value = stats[name];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`${backend} ${dpr}x Slug ${name} is not a finite non-negative metric`);
    }
  }
  for (const name of ['fpsHistoryCursor', 'gpuHistoryCursor'] as const) {
    const cursor = stats[name];
    if (
      typeof cursor !== 'object' ||
      cursor === null ||
      Array.isArray(cursor) ||
      !Number.isSafeInteger(cursor.length) ||
      cursor.length < 0
    ) {
      throw new Error(`${backend} ${dpr}x Slug ${name} is invalid`);
    }
  }
  if (
    stats.slugGpuBytes !== stats.slugCurveGpuBytes + stats.slugHeaderGpuBytes + stats.slugReferenceGpuBytes ||
    stats.atlasGpuBytes !== stats.slugGpuBytes ||
    stats.totalGpuBytes !== stats.slugGpuBytes + stats.framebufferGpuBytes
  ) {
    throw new Error(`${backend} ${dpr}x Slug resource-byte accounting is inconsistent`);
  }
  if (stats.missingGlyphCount !== 0 || stats.glyphCount === 0 || stats.slugReferenceCount === 0) {
    throw new Error(`${backend} ${dpr}x Slug specimen did not render complete analytic glyphs`);
  }
}
