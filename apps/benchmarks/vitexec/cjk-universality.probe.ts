import type { BenchmarkMeasurement } from '../src/benchmark/contracts';

const executionPath = '/src/benchmark/execution.ts';
const environmentPath = '/src/benchmark/environment.ts';
const [{ runRegisteredBenchmark }, { environmentResource }] = await Promise.all([
  import(/* @vite-ignore */ executionPath),
  import(/* @vite-ignore */ environmentPath),
]);
const environment = await environmentResource();
if (environment.webgpu !== true) throw new Error('CJK live probe requires WebGPU-capable Chrome');

const result = await runRegisteredBenchmark({
  targetId: 'cjk-universality',
  scenarioId: 'cjk-universality',
  input: {},
  controls: { dpr: 1, samples: 3, warmup: 1 },
  environment,
});
const expectedHash =
  'a1a833f2:fbe2aa07:922f9a2e:8c977f4d:85a2f640:fd42b9f7:53d8ec89:8cb3050c:bbfd039d:837a2b43:2f450f5e:9900b4af:c49f3e68';
if (
  result.status !== 'passed' ||
  result.measurements.length !== 3 ||
  result.measurements.some((measurement: BenchmarkMeasurement) => {
    const metrics = measurement.metrics;
    return (
      measurement.hash !== expectedHash ||
      measurement.outputBytes !== 10_622 ||
      metrics?.sourceUtf16Units !== 208 ||
      metrics.corpusCaseCount !== 13 ||
      metrics.corpusGlyphCount !== 64 ||
      metrics.paragraphCaseCount !== 4 ||
      metrics.layoutCount !== 12 ||
      metrics.directShapeBoundaryCrossings !== 1 ||
      metrics.paragraphShapeBoundaryCrossings !== 4 ||
      metrics.reshapeBoundaryCrossings !== 0 ||
      metrics.planCount !== 8 ||
      metrics.retainedFontBytes !== 1_539_372 ||
      metrics.wasmMemoryBytes !== 4_718_592 ||
      metrics.sourceFontBytes !== 16_467_736 ||
      metrics.artifactBytes !== 1_540_480 ||
      metrics.shapingPayloadRawBytes !== 1_539_372 ||
      metrics.shapingPayloadGzipBytes !== 654_925 ||
      metrics.shapingPayloadBrotliBytes !== 514_547
    );
  })
) {
  throw new Error('CJK live probe did not preserve its exact shaping and paragraph contract');
}

console.log(
  'cjk-universality-ready',
  JSON.stringify({
    schemaVersion: 0,
    hash: expectedHash,
    outputBytes: result.outputBytes,
    validation: result.validation,
    webgpu: result.environment.webgpu,
  }),
);

export {};
