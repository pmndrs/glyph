export {}

const executionPath = '/src/benchmark/execution.ts'
const environmentPath = '/src/benchmark/environment.ts'
const [{ runRegisteredBenchmark }, { environmentResource }] = await Promise.all([
  import(/* @vite-ignore */ executionPath),
  import(/* @vite-ignore */ environmentPath),
])
const environment = await environmentResource()

for (const backend of ['webgpu', 'webgl2'] as const) {
  if (backend === 'webgpu' && !environment.webgpu) continue
  for (const technique of ['bitmap', 'mtsdf'] as const) {
    const summary = await runRegisteredBenchmark({
      targetId: `runtime-fallback-${technique}-${backend}`,
      scenarioId: 'runtime-fallback-parity',
      input: { fontFixture: 'inter' },
      controls: { dpr: 1, samples: 1, warmup: 0 },
      environment,
    })
    const metrics = summary.measurements[0]?.metrics
    if (
      summary.status !== 'passed' ||
      metrics?.mismatchBytes !== 0 ||
      metrics.changedPixels !== 0 ||
      metrics.maximumError !== 0
    ) {
      throw new Error(`${technique} ${backend} runtime fallback diverged from its baked frame`)
    }
    console.log('runtime-fallback-ready', technique, backend, summary.medianMs)
  }
}
