const executionPath = '/src/benchmark/execution.ts';
const environmentPath = '/src/benchmark/environment.ts';
const [{ runRegisteredBenchmark }, { environmentResource }] = await Promise.all([
  import(/* @vite-ignore */ executionPath),
  import(/* @vite-ignore */ environmentPath),
]);
const environment = await environmentResource();
if (!environment.webgpu) throw new Error('MTSDF WebGPU probe requires an available WebGPU adapter');

const result = await runRegisteredBenchmark({
  targetId: 'mtsdf-text-webgpu',
  scenarioId: 'mtsdf-text-scenes',
  input: {},
  controls: { dpr: 1, samples: 2, warmup: 1 },
  environment,
});
if (!result.validation.includes('deterministic MTSDF')) {
  throw new Error('MTSDF WebGPU probe did not publish its rendering validation');
}
for (const measurement of result.measurements) {
  if (
    measurement.metrics?.backendWebGpu !== 1 ||
    measurement.metrics.backendWebGl2 !== 0 ||
    measurement.metrics.changedPixels < 500
  ) {
    throw new Error('MTSDF WebGPU probe did not execute the exact GPU backend and pixel contract');
  }
}
const conformance = await runRegisteredBenchmark({
  targetId: 'mtsdf-conformance-webgpu',
  scenarioId: 'mtsdf-sampling-conformance',
  input: { fontFixture: 'inter' },
  controls: { dpr: 1, samples: 2, warmup: 1 },
  environment,
});
if (!conformance.validation.includes('CPU MTSDF comparison')) {
  throw new Error('MTSDF WebGPU probe did not publish its sampling validation');
}
for (const measurement of conformance.measurements) {
  if (
    measurement.metrics?.backendWebGpu !== 1 ||
    measurement.metrics.fixtureIsInter !== 1 ||
    measurement.metrics.meanAbsoluteError > 0.25 ||
    measurement.metrics.maximumError > 48 ||
    measurement.metrics.errorPixels > 5_000
  ) {
    throw new Error('MTSDF WebGPU probe exceeded its base-level CPU comparison envelope');
  }
}
console.log(
  'mtsdf-webgpu-ready',
  JSON.stringify({
    schemaVersion: 0,
    validation: result.validation,
    hash: result.measurements[0]?.hash,
    metrics: result.measurements[0]?.metrics,
    conformanceHash: conformance.measurements[0]?.hash,
    conformanceMetrics: conformance.measurements[0]?.metrics,
    environment,
  }),
);

export {};
