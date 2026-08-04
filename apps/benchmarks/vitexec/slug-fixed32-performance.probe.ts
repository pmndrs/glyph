import type {
  ComparisonWorkloadPreview,
  ComparisonWorkloadStats,
} from '../src/benchmark/targets/measurement/comparison-preview';

export {};

type SlugStats = Extract<ComparisonWorkloadStats, { readonly technique: 'slug' }>;
type Variant = 'fixed16' | 'fixed32';

const comparisonWorkloadPath = '/src/benchmark/targets/measurement/comparison-preview.ts';
const environmentPath = '/src/benchmark/environment.ts';
const fontFixturesPath = '/src/benchmark/font-fixtures.ts';
const productResultPath = '/src/benchmark/product-result.ts';
const manifestPath = '/fixtures/autoresearch/slug-fixed32-bands-001/artifacts-v0.json';
const STEADY_STATE_REPORT_COUNT = 12;
const ROUND_COUNT = 5;
const VIEWPORT_WIDTH = 1500;
const VIEWPORT_HEIGHT = 950;
const DPR = 2;
const WORKLOAD = 'text-ladder';
const FONT_FIXTURES = ['inter', 'noto-sans-cjk-showcase'] as const;
const [{ createComparisonWorkloadPreview }, { environmentResource }, fontFixtures, productResult, manifest] =
  await Promise.all([
    import(/* @vite-ignore */ comparisonWorkloadPath),
    import(/* @vite-ignore */ environmentPath),
    import(/* @vite-ignore */ fontFixturesPath),
    import(/* @vite-ignore */ productResultPath),
    fetchJson<Fixed32Manifest>(manifestPath),
  ]);

const runs: Array<Record<string, unknown>> = [];
for (const backend of ['webgpu', 'webgl2'] as const) {
  for (const fontFixture of FONT_FIXTURES) {
    const specimen = fontFixtures.rasterConformanceSpecimen(fontFixture);
    const artifact = manifest.artifacts.find((candidate) => candidate.fontFixture === fontFixture);
    if (artifact === undefined) throw new Error(`${fontFixture} lacks a fixed-32 artifact`);
    const fixed32 = {
      url: new URL(`/fixtures/autoresearch/slug-fixed32-bands-001/${artifact.file}`, location.origin).href,
      compressed: artifact.compressed,
      uncompressed: artifact.uncompressed,
    };
    for (let round = 0; round < ROUND_COUNT; round += 1) {
      const order: readonly Variant[] = round % 2 === 0 ? ['fixed16', 'fixed32'] : ['fixed32', 'fixed16'];
      for (const variant of order) {
        const id = `${backend}-${fontFixture}-r${round}-${variant}`;
        console.log('slug-fixed32-performance-start', id);
        const canvas = document.createElement('canvas');
        canvas.dataset.slugFixed32PerformanceRun = id;
        document.body.append(canvas);
        let preview: ComparisonWorkloadPreview | undefined;
        try {
          let settled = false;
          let resolveResult: (stats: SlugStats) => void = () => undefined;
          let rejectResult: (error: unknown) => void = () => undefined;
          const result = new Promise<SlugStats>((resolve, reject) => {
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
            dpr: DPR,
            fontFixture,
            fontSize: 16,
            height: VIEWPORT_HEIGHT,
            layoutWidthRatio: 0.72,
            paintOpacity: 1,
            paintShadowEnabled: false,
            paintStrokeWidth: 0,
            showGrid: false,
            showLayoutBounds: false,
            ...(variant === 'fixed32' ? { slugBakedArtifact: fixed32 } : {}),
            technique: 'slug',
            textLadderSpecimen: specimen,
            width: VIEWPORT_WIDTH,
            workload: WORKLOAD,
            onError: fail,
            onStats: (stats: ComparisonWorkloadStats) => {
              if (settled) return;
              try {
                assertStats(stats, backend);
                if (
                  stats.fpsHistoryCursor.length < STEADY_STATE_REPORT_COUNT ||
                  stats.gpuHistoryCursor.length < STEADY_STATE_REPORT_COUNT
                ) {
                  return;
                }
                settled = true;
                resolveResult(stats);
              } catch (error) {
                fail(error);
              }
            },
          });
          const stats = await result;
          runs.push({
            id,
            backend,
            dpr: DPR,
            fontFixture,
            round,
            order: order.join('-then-'),
            variant,
            stats: productResult.captureLiveTextStats(stats),
          });
        } finally {
          await preview?.dispose();
          canvas.remove();
        }
        console.log('slug-fixed32-performance-complete', id);
      }
    }
  }
}

const gpuAdapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
const gpuAdapterInfo = gpuAdapter?.info;
console.log(
  'slug-fixed32-performance-ready',
  JSON.stringify({
    schemaVersion: 0,
    kind: 'slug-fixed32-performance-observation',
    experimentId: manifest.experimentId,
    baseCommit: manifest.baseCommit,
    capturedAt: new Date().toISOString(),
    technique: 'slug',
    delivery: 'baked',
    workload: WORKLOAD,
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    dpr: DPR,
    roundCount: ROUND_COUNT,
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
    runs,
  }),
);

function assertStats(stats: ComparisonWorkloadStats, backend: 'webgpu' | 'webgl2'): asserts stats is SlugStats {
  if (
    stats.technique !== 'slug' ||
    stats.backend !== backend ||
    stats.dpr !== DPR ||
    stats.workload !== WORKLOAD ||
    stats.gpuTimingSupported !== true ||
    stats.missingGlyphCount !== 0 ||
    stats.glyphCount === 0 ||
    stats.slugReferenceCount === 0
  ) {
    throw new Error(`${backend} fixed-band run did not preserve the requested product contract`);
  }
}

async function fetchJson<Value>(url: string): Promise<Value> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return (await response.json()) as Value;
}

interface Fixed32Manifest {
  readonly experimentId: string;
  readonly baseCommit: string;
  readonly artifacts: readonly {
    readonly fontFixture: string;
    readonly file: string;
    readonly compressed: { readonly bytes: number; readonly sha256: string };
    readonly uncompressed: { readonly bytes: number; readonly sha256: string };
  }[];
}
