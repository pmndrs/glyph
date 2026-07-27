export {}

const executionPath = '/src/benchmark/execution.ts'
const environmentPath = '/src/benchmark/environment.ts'
const [{ runRegisteredBenchmark }, { environmentResource }] = await Promise.all([
  import(/* @vite-ignore */ executionPath),
  import(/* @vite-ignore */ environmentPath),
])

for (const technique of ['bitmap', 'mtsdf'] as const) {
  const summary = await runRegisteredBenchmark({
    targetId: `source-outline-${technique}-webgpu`,
    scenarioId: 'source-outline-fidelity',
    input: { fontFixture: 'inter' },
    controls: { dpr: 1, samples: 1, warmup: 0 },
    environment: await environmentResource(),
  })
  if (
    summary.status !== 'passed' ||
    !summary.validation.includes('within reviewed envelopes') ||
    summary.measurements[0]?.metrics?.physicalPpem !== (technique === 'bitmap' ? 16 : 64)
  ) {
    throw new Error(`${technique} source-outline fidelity did not preserve its contract`)
  }
}

console.log('source-outline-fidelity-probe-ready')
