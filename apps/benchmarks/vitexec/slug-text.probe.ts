const executionPath = '/src/benchmark/execution.ts';
const environmentPath = '/src/benchmark/environment.ts';
const [{ runRegisteredBenchmark }, { environmentResource }] = await Promise.all([
  import(/* @vite-ignore */ executionPath),
  import(/* @vite-ignore */ environmentPath),
]);
const environment = await environmentResource();
if (!environment.webgpu) throw new Error('Slug WebGPU probe requires an available WebGPU adapter');

const result = await runRegisteredBenchmark({
  targetId: 'slug-text-webgpu',
  scenarioId: 'slug-text-scenes',
  input: {},
  controls: { dpr: 1, samples: 2, warmup: 1 },
  environment,
});
if (!result.validation.includes('deterministic Slug')) {
  throw new Error('Slug WebGPU probe did not publish its rendering validation');
}
for (const measurement of result.measurements) {
  if (
    measurement.metrics?.backendWebGpu !== 1 ||
    measurement.metrics.backendWebGl2 !== 0 ||
    measurement.metrics.changedPixels < 500 ||
    measurement.metrics.slugCurveGpuBytes <= 0 ||
    measurement.metrics.slugHeaderGpuBytes <= 0 ||
    measurement.metrics.slugReferenceGpuBytes <= 0 ||
    measurement.metrics.slugGpuBytes !==
      measurement.metrics.slugCurveGpuBytes +
        measurement.metrics.slugHeaderGpuBytes +
        measurement.metrics.slugReferenceGpuBytes
  ) {
    throw new Error('Slug WebGPU probe did not execute the exact GPU backend and pixel contract');
  }
}
const conformance = await runRegisteredBenchmark({
  targetId: 'slug-conformance-webgpu',
  scenarioId: 'slug-sampling-conformance',
  input: { fontFixture: 'inter' },
  controls: { dpr: 1, samples: 2, warmup: 1 },
  environment,
});
if (!conformance.validation.includes('CPU Slug comparison')) {
  throw new Error('Slug WebGPU probe did not publish its sampling validation');
}
for (const measurement of conformance.measurements) {
  if (
    measurement.metrics?.backendWebGpu !== 1 ||
    measurement.metrics.fixtureIsInter !== 1 ||
    measurement.metrics.evaluatedCurves <= 0 ||
    measurement.metrics.meanAbsoluteError > 0.25 ||
    measurement.metrics.maximumError > 128 ||
    measurement.metrics.errorPixels > measurement.metrics.pixelCount * 0.03
  ) {
    throw new Error('Slug WebGPU probe exceeded its analytic CPU comparison envelope');
  }
}
console.log(
  'slug-webgpu-ready',
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
