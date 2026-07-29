import type {
  ComparisonWorkloadPreview,
  ComparisonWorkloadStats,
} from '../src/renderer/comparison-workload'

export {}

type SlugStats = Extract<ComparisonWorkloadStats, { readonly technique: 'slug' }>
type Variant = 'multiply-zero' | 'zero-width-branch'

const comparisonWorkloadPath = '/src/renderer/comparison-workload.ts'
const environmentPath = '/src/benchmark/environment.ts'
const productResultPath = '/src/benchmark/product-result.ts'
const EXPERIMENT_ID = 'slug-outline-zero-branch-001'
const baseCommit = requiredCommit('baseCommit')
const candidateCommit = requiredCommit('candidateCommit')
const backend = requiredBackend()
const STEADY_STATE_REPORT_COUNT = 12
const PAIRS_PER_BACKEND = 64
const VIEWPORT_WIDTH = 1500
const VIEWPORT_HEIGHT = 950
const DPR = 2
const FONT_FIXTURE = 'inter'
const WORKLOAD = 'paint-effects'
const PAINT_STROKE_WIDTH = 0.1
const FONT_SIZES = [16, 40, 128] as const
const variants = ['multiply-zero', 'zero-width-branch'] as const
const [{ createComparisonWorkloadPreview }, { environmentResource }, productResult] =
  await Promise.all([
    import(/* @vite-ignore */ comparisonWorkloadPath),
    import(/* @vite-ignore */ environmentPath),
    import(/* @vite-ignore */ productResultPath),
  ])

const runs: Array<Record<string, unknown>> = []
let mixedPair = 0
for (let pair = 0; pair < PAIRS_PER_BACKEND; pair += 1) {
  const paintStrokePattern = pair % 4 === 3 ? 'all' : 'alternating'
  const fontSize =
    paintStrokePattern === 'all'
      ? FONT_SIZES[Math.floor(pair / 4) % FONT_SIZES.length]!
      : FONT_SIZES[mixedPair++ % FONT_SIZES.length]!
  const order: readonly Variant[] = pair % 2 === 0 ? variants : variants.toReversed()
  for (const variant of order) {
    const id = `${backend}-${paintStrokePattern}-${String(fontSize)}px-p${String(pair)}-${variant}`
    console.log('slug-outline-zero-branch-performance-start', id)
    const canvas = document.createElement('canvas')
    canvas.dataset.slugOutlineZeroBranchPerformanceRun = id
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
        fontFixture: FONT_FIXTURE,
        fontSize,
        height: VIEWPORT_HEIGHT,
        layoutWidthRatio: 0.72,
        paintOpacity: 1,
        paintShadowEnabled: false,
        paintStrokePattern,
        paintStrokeWidth: PAINT_STROKE_WIDTH,
        showGrid: false,
        showLayoutBounds: false,
        slugOutlineExperimentVariant: variant,
        technique: 'slug',
        width: VIEWPORT_WIDTH,
        workload: WORKLOAD,
        onError: fail,
        onStats: (stats: ComparisonWorkloadStats) => {
          if (settled) return
          try {
            assertStats(stats, backend, fontSize, paintStrokePattern)
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
        fontFixture: FONT_FIXTURE,
        fontSize,
        paintStrokePattern,
        pair,
        order: order.join('-then-'),
        variant,
        stats: productResult.captureLiveTextStats(stats),
      })
    } finally {
      await preview?.dispose()
      canvas.remove()
    }
    console.log('slug-outline-zero-branch-performance-complete', id)
  }
}

const gpuAdapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
const gpuAdapterInfo = gpuAdapter?.info
console.log(
  'slug-outline-zero-branch-performance-ready',
  JSON.stringify({
    schemaVersion: 0,
    kind: 'slug-outline-zero-branch-performance-observation',
    experimentId: EXPERIMENT_ID,
    baseCommit,
    candidateCommit,
    backend,
    capturedAt: new Date().toISOString(),
    technique: 'slug',
    delivery: 'baked',
    workload: WORKLOAD,
    fontFixture: FONT_FIXTURE,
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    dpr: DPR,
    fontSizes: FONT_SIZES,
    pairsPerBackend: PAIRS_PER_BACKEND,
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

function requiredCommit(name: string): string {
  const value = new URL(location.href).searchParams.get(name)
  if (value === null || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`Slug outline zero-branch probe requires an exact ${name} query parameter`)
  }
  return value
}

function requiredBackend(): 'webgpu' | 'webgl2' {
  const value = new URL(location.href).searchParams.get('backend')
  if (value !== 'webgpu' && value !== 'webgl2') {
    throw new Error('Slug outline zero-branch probe requires an exact backend query parameter')
  }
  return value
}

function assertStats(
  stats: ComparisonWorkloadStats,
  expectedBackend: 'webgpu' | 'webgl2',
  fontSize: number,
  paintStrokePattern: 'all' | 'alternating',
): asserts stats is SlugStats {
  if (
    stats.technique !== 'slug' ||
    stats.backend !== expectedBackend ||
    stats.dpr !== DPR ||
    stats.workload !== WORKLOAD ||
    stats.gpuTimingSupported !== true ||
    stats.missingGlyphCount !== 0 ||
    stats.glyphCount === 0 ||
    stats.drawCount !== 1 ||
    stats.slugReferenceCount === 0 ||
    stats.appliedFontSize !== fontSize ||
    stats.appliedPaintStrokePattern !== paintStrokePattern ||
    stats.appliedPaintStrokeWidth !== PAINT_STROKE_WIDTH
  ) {
    throw new Error(
      `${expectedBackend} ${paintStrokePattern} ${String(fontSize)}px zero-branch run changed its product contract`,
    )
  }
}
