import type {
  ComparisonWorkloadPreview,
  ComparisonWorkloadStats,
} from '../src/renderer/comparison-workload'

export {}

type SlugComparisonWorkloadStats = Extract<ComparisonWorkloadStats, { readonly technique: 'slug' }>

const comparisonWorkloadPath = '/src/renderer/comparison-workload.ts'
const environmentPath = '/src/benchmark/environment.ts'
const productResultPath = '/src/benchmark/product-result.ts'
const STEADY_STATE_REPORT_COUNT = 12
const VIEWPORT_WIDTH = 1500
const VIEWPORT_HEIGHT = 950
const FONT_FIXTURE = 'inter'
const FONT_SIZE = 40
const WORKLOAD = 'paint-effects'
const PAINT_STROKE_WIDTH = 0.1
const EXPECTED_LOGICAL_GLYPH_COUNT = 268
const variants = [
  { label: 'fill', paintStrokeWidth: 0, paintStrokePattern: 'all', expectedDrawCount: 1 },
  {
    label: 'outline',
    paintStrokeWidth: PAINT_STROKE_WIDTH,
    paintStrokePattern: 'all',
    expectedDrawCount: 1,
  },
  {
    label: 'mixed',
    paintStrokeWidth: PAINT_STROKE_WIDTH,
    paintStrokePattern: 'alternating',
    expectedDrawCount: 1,
  },
] as const
const [{ createComparisonWorkloadPreview }, { environmentResource }, productResult] =
  await Promise.all([
    import(/* @vite-ignore */ comparisonWorkloadPath),
    import(/* @vite-ignore */ environmentPath),
    import(/* @vite-ignore */ productResultPath),
  ])

const cases: Array<Record<string, unknown>> = []
for (const backend of ['webgpu', 'webgl2'] as const) {
  for (const dpr of [1, 2] as const) {
    for (const variant of variants) {
      const id = `${backend}-${dpr}x-${FONT_FIXTURE}-${variant.label}`
      console.log('slug-outline-performance-start', id)
      const canvas = document.createElement('canvas')
      canvas.dataset.slugOutlinePerformanceCase = id
      document.body.append(canvas)
      let preview: ComparisonWorkloadPreview | undefined
      try {
        let settled = false
        let resolveResult: (result: Record<string, unknown>) => void = () => undefined
        let rejectResult: (error: unknown) => void = () => undefined
        const result = new Promise<Record<string, unknown>>((resolve, reject) => {
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
          dpr,
          fontFixture: FONT_FIXTURE,
          fontSize: FONT_SIZE,
          height: VIEWPORT_HEIGHT,
          layoutWidthRatio: 0.72,
          paintOpacity: 1,
          paintShadowEnabled: false,
          paintStrokePattern: variant.paintStrokePattern,
          paintStrokeWidth: variant.paintStrokeWidth,
          showGrid: false,
          showLayoutBounds: false,
          technique: 'slug',
          width: VIEWPORT_WIDTH,
          workload: WORKLOAD,
          onError: fail,
          onStats: (stats: ComparisonWorkloadStats) => {
            if (settled) return
            try {
              assertCaseStats(stats, backend, dpr, variant)
              if (
                stats.fpsHistoryCursor.length < STEADY_STATE_REPORT_COUNT ||
                stats.gpuHistoryCursor.length < STEADY_STATE_REPORT_COUNT
              ) {
                return
              }
              settled = true
              resolveResult({
                id,
                backend,
                dpr,
                variant: variant.label,
                expectedDrawCount: variant.expectedDrawCount,
                requestedPaintStrokePattern: variant.paintStrokePattern,
                requestedPaintStrokeWidth: variant.paintStrokeWidth,
                stats: productResult.captureLiveTextStats(stats),
              })
            } catch (error) {
              fail(error)
            }
          },
        })
        cases.push(await result)
      } finally {
        await preview?.dispose()
        canvas.remove()
      }
      console.log('slug-outline-performance-complete', id)
    }
  }
}

const gpuAdapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
const gpuAdapterInfo = gpuAdapter?.info
console.log(
  'slug-outline-performance-summary',
  JSON.stringify(
    cases.map((entry) => {
      const stats = entry.stats as ReturnType<typeof productResult.captureLiveTextStats>
      return {
        id: entry.id,
        drawCount: stats.drawCount,
        glyphCount: stats.glyphCount,
        startupMs: stats.startupMs,
        medianGpuMs: stats.medianGpuMs,
        p95GpuMs: stats.p95GpuMs,
        medianSubmitMs: stats.medianSubmitMs,
      }
    }),
  ),
)
console.log(
  'slug-outline-performance-ready',
  JSON.stringify({
    schemaVersion: 0,
    kind: 'slug-outline-performance-observation',
    capturedAt: new Date().toISOString(),
    technique: 'slug',
    delivery: 'baked',
    workload: WORKLOAD,
    fontFixture: FONT_FIXTURE,
    animationEnabled: false,
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    steadyStateReportCount: STEADY_STATE_REPORT_COUNT,
    variants,
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
)

function assertCaseStats(
  stats: ComparisonWorkloadStats,
  backend: 'webgpu' | 'webgl2',
  dpr: 1 | 2,
  variant: (typeof variants)[number],
): asserts stats is SlugComparisonWorkloadStats {
  if (
    stats.technique !== 'slug' ||
    stats.backend !== backend ||
    stats.dpr !== dpr ||
    stats.workload !== WORKLOAD ||
    stats.appliedAnimationEnabled !== false ||
    stats.appliedPaintShadowEnabled !== false ||
    stats.appliedPaintStrokePattern !== variant.paintStrokePattern ||
    stats.appliedPaintStrokeWidth !== variant.paintStrokeWidth
  ) {
    throw new Error(`${backend} ${dpr}x ${variant.label} Slug preview changed its requested paint`)
  }
  if (stats.drawCount !== variant.expectedDrawCount) {
    throw new Error(
      `${backend} ${dpr}x ${variant.label} Slug draw count is ${stats.drawCount}, expected ${variant.expectedDrawCount}`,
    )
  }
  if (stats.gpuTimingSupported !== true) {
    throw new Error(
      `${backend} ${dpr}x ${variant.label} Slug preview did not expose GPU timestamps`,
    )
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
    const value = stats[name]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`${backend} ${dpr}x ${variant.label} Slug ${name} is invalid`)
    }
  }
  if (
    stats.slugGpuBytes !==
      stats.slugCurveGpuBytes + stats.slugHeaderGpuBytes + stats.slugReferenceGpuBytes ||
    stats.atlasGpuBytes !== stats.slugGpuBytes ||
    stats.totalGpuBytes !== stats.slugGpuBytes + stats.framebufferGpuBytes
  ) {
    throw new Error(
      `${backend} ${dpr}x ${variant.label} Slug resource-byte accounting is inconsistent`,
    )
  }
  if (
    stats.missingGlyphCount !== 0 ||
    stats.glyphCount !== EXPECTED_LOGICAL_GLYPH_COUNT ||
    stats.slugReferenceCount === 0
  ) {
    throw new Error(
      `${backend} ${dpr}x ${variant.label} Slug did not render complete analytic glyphs`,
    )
  }
}
