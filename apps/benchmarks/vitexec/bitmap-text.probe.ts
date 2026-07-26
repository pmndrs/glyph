import type { BenchmarkMeasurement } from '../src/benchmark/contracts'

const executionPath = '/src/benchmark/execution.ts'
const environmentPath = '/src/benchmark/environment.ts'
const [{ runRegisteredBenchmark }, { environmentResource }] = await Promise.all([
  import(/* @vite-ignore */ executionPath),
  import(/* @vite-ignore */ environmentPath),
])
const environment = await environmentResource()
if (environment.webgpu !== true) throw new Error('Bitmap text probe requires WebGPU-capable Chrome')

for (const dpr of [1, 2] as const) {
  const backendLitPixels: number[] = []
  const backendInkPixels: number[] = []
  const backendInkBounds: number[][] = []
  const expectedOutputBytes = 320 * dpr * 96 * dpr * 4
  for (const [targetId, backendMetric] of [
    ['bitmap-text-webgpu', 'backendWebGpu'],
    ['bitmap-text-webgl2', 'backendWebGl2'],
  ] as const) {
    const result = await runRegisteredBenchmark({
      targetId,
      scenarioId: 'bitmap-text-frame',
      input: {},
      controls: { dpr, samples: 3, warmup: 1 },
      environment,
    })
    if (
      result.status !== 'passed' ||
      result.controls.dpr !== dpr ||
      result.measurements.length !== 3 ||
      result.measurements.some(
        (measurement: BenchmarkMeasurement) =>
          measurement.outputBytes !== expectedOutputBytes ||
          measurement.metrics?.dpr !== dpr ||
          measurement.metrics[backendMetric] !== 1 ||
          measurement.metrics.glyphCount !== 10 ||
          measurement.metrics.drawCount !== 1 ||
          measurement.metrics.atlasGpuBytes !== 695_296 ||
          measurement.metrics.renderTargetGpuBytes !== expectedOutputBytes ||
          measurement.metrics.totalGpuBytes !== 695_296 + expectedOutputBytes ||
          (measurement.metrics.litPixels ?? 0) < 100 ||
          (measurement.metrics.inkPixels ?? 0) < 100,
      )
    ) {
      throw new Error(`${targetId} at ${dpr}x did not preserve its bitmap font-frame contract`)
    }
    const firstMetrics = result.measurements[0]!.metrics!
    backendLitPixels.push(firstMetrics.litPixels!)
    backendInkPixels.push(firstMetrics.inkPixels!)
    const inkBounds = [
      firstMetrics.inkMinX,
      firstMetrics.inkMinY,
      firstMetrics.inkMaxX,
      firstMetrics.inkMaxY,
    ]
    backendInkBounds.push(inkBounds)
    console.log(
      'bitmap-text-ready',
      JSON.stringify({
        targetId,
        dpr,
        hash: result.measurements[0]?.hash,
        medianMs: result.medianMs,
        litPixels: firstMetrics.litPixels,
        inkPixels: firstMetrics.inkPixels,
        inkBounds,
        atlasGpuBytes: firstMetrics.atlasGpuBytes,
        renderTargetGpuBytes: firstMetrics.renderTargetGpuBytes,
        totalGpuBytes: firstMetrics.totalGpuBytes,
        validation: result.validation,
      }),
    )
  }
  const [webGpuInkPixels, webGl2InkPixels] = backendInkPixels
  if (webGpuInkPixels === undefined || webGpuInkPixels !== webGl2InkPixels) {
    throw new Error(`WebGPU and WebGL2 half-coverage ink counts differ at ${dpr}x`)
  }
  const [webGpuLitPixels, webGl2LitPixels] = backendLitPixels
  if (
    webGpuLitPixels === undefined ||
    webGl2LitPixels === undefined ||
    Math.abs(webGpuLitPixels - webGl2LitPixels) > Math.max(webGpuLitPixels, webGl2LitPixels) * 0.02
  ) {
    throw new Error(
      `WebGPU and WebGL2 bitmap edge coverage differs by more than two percent at ${dpr}x`,
    )
  }
  const [webGpuBounds, webGl2Bounds] = backendInkBounds
  if (
    webGpuBounds === undefined ||
    webGl2Bounds === undefined ||
    webGpuBounds.some((value, index) => value !== webGl2Bounds[index])
  ) {
    throw new Error(`WebGPU and WebGL2 half-coverage ink bounds differ at ${dpr}x`)
  }
}

export {}
