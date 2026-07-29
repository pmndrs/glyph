import type {
  ComparisonWorkloadPreview,
  ComparisonWorkloadStats,
} from '../src/renderer/comparison-workload'

export {}

type SlugStats = Extract<ComparisonWorkloadStats, { readonly technique: 'slug' }>
type Variant = 'baseline' | 'root-branch'

const comparisonWorkloadPath = '/src/renderer/comparison-workload.ts'
const environmentPath = '/src/benchmark/environment.ts'
const fontFixturesPath = '/src/benchmark/font-fixtures.ts'
const productResultPath = '/src/benchmark/product-result.ts'
const EXPERIMENT_ID = 'slug-root-branch-001'
const baseCommit = requiredBaseCommit()
const candidateCommit = requiredCommit('candidateCommit')
const STEADY_STATE_REPORT_COUNT = 12
const ROUND_COUNT = 5
const VIEWPORT_WIDTH = 1500
const VIEWPORT_HEIGHT = 950
const DPR = 2
const WORKLOAD = 'text-ladder'
const FONT_FIXTURES = [
  'inter',
  'amiri',
  'noto-sans-devanagari',
  'dot-gothic-16',
  'noto-sans-cjk-showcase',
  'source-serif-4',
  'dancing-script',
] as const
const [{ createComparisonWorkloadPreview }, { environmentResource }, fontFixtures, productResult] =
  await Promise.all([
    import(/* @vite-ignore */ comparisonWorkloadPath),
    import(/* @vite-ignore */ environmentPath),
    import(/* @vite-ignore */ fontFixturesPath),
    import(/* @vite-ignore */ productResultPath),
  ])

const runs: Array<Record<string, unknown>> = []
for (const backend of ['webgpu', 'webgl2'] as const) {
  for (const fontFixture of FONT_FIXTURES) {
    const specimen = fontFixtures.rasterConformanceSpecimen(fontFixture)
    for (let round = 0; round < ROUND_COUNT; round += 1) {
      const order: readonly Variant[] =
        round % 2 === 0 ? ['baseline', 'root-branch'] : ['root-branch', 'baseline']
      for (const variant of order) {
        const id = `${backend}-${fontFixture}-r${String(round)}-${variant}`
        console.log('slug-root-branch-performance-start', id)
        const canvas = document.createElement('canvas')
        canvas.dataset.slugRootBranchPerformanceRun = id
        document.body.append(canvas)
        let preview: ComparisonWorkloadPreview | undefined
        try {
          let settled = false
          let resolveResult: (stats: SlugStats) => void = () => undefined
          let rejectResult: (error: unknown) => void = () => undefined
          const result = new Promise<SlugStats>((resolve, reject) => {
            resolveResult = resolve
            rejectResult = reject
          })
          const fail = (error: unknown): void => {
            if (settled) return
            settled = true
            rejectResult(error)
          }
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
            ...(variant === 'root-branch' ? { slugExperimentVariant: variant } : {}),
            technique: 'slug',
            textLadderSpecimen: specimen,
            width: VIEWPORT_WIDTH,
            workload: WORKLOAD,
            onError: fail,
            onStats: (stats: ComparisonWorkloadStats) => {
              if (settled) return
              try {
                assertStats(stats, backend)
                if (
                  stats.fpsHistoryCursor.length < STEADY_STATE_REPORT_COUNT ||
                  stats.gpuHistoryCursor.length < STEADY_STATE_REPORT_COUNT
                ) {
                  return
                }
                settled = true
                resolveResult(stats)
              } catch (error) {
                fail(error)
              }
            },
          })
          const stats = await result
          runs.push({
            id,
            backend,
            dpr: DPR,
            fontFixture,
            round,
            order: order.join('-then-'),
            variant,
            stats: productResult.captureLiveTextStats(stats),
          })
        } finally {
          await preview?.dispose()
          canvas.remove()
        }
        console.log('slug-root-branch-performance-complete', id)
      }
    }
  }
}

const gpuAdapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
const gpuAdapterInfo = gpuAdapter?.info
console.log(
  'slug-root-branch-performance-ready',
  JSON.stringify({
    schemaVersion: 0,
    kind: 'slug-root-branch-performance-observation',
    experimentId: EXPERIMENT_ID,
    baseCommit,
    candidateCommit,
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
)

function requiredBaseCommit(): string {
  return requiredCommit('baseCommit')
}

function requiredCommit(name: string): string {
  const value = new URL(location.href).searchParams.get(name)
  if (value === null || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`Slug root-branch probe requires an exact ${name} query parameter`)
  }
  return value
}

function assertStats(
  stats: ComparisonWorkloadStats,
  backend: 'webgpu' | 'webgl2',
): asserts stats is SlugStats {
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
    throw new Error(`${backend} root-branch run did not preserve the requested product contract`)
  }
}
