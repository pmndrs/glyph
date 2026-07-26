const executionPath = '/src/benchmark/execution.ts'
const environmentPath = '/src/benchmark/environment.ts'
const [{ runRegisteredBenchmark }, { environmentResource }] = await Promise.all([
  import(/* @vite-ignore */ executionPath),
  import(/* @vite-ignore */ environmentPath),
])
const summary = await runRegisteredBenchmark({
  targetId: 'synthetic',
  scenarioId: 'overview',
  input: {},
  controls: { dpr: 1, samples: 1, warmup: 0 },
  environment: await environmentResource(),
})
if (summary.measurements[0]?.hash !== 'intentionally-wrong') {
  throw new Error('negative-control expected hash mismatch')
}

export {}
