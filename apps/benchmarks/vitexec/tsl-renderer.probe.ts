import type { BenchmarkMeasurement } from '../src/benchmark/contracts';

const executionPath = '/src/benchmark/execution.ts';
const environmentPath = '/src/benchmark/environment.ts';
const [{ runRegisteredBenchmark }, { environmentResource }] = await Promise.all([
  import(/* @vite-ignore */ executionPath),
  import(/* @vite-ignore */ environmentPath),
]);
const environment = await environmentResource();
if (environment.webgpu !== true) throw new Error('TSL renderer probe requires WebGPU-capable Chrome');
const expectedHash = 'fec0f57de0b19bc7dacb5b0fc3de7b56fc68dfdbeeebc8f9f4c506bf6e821c77';

for (const [targetId, backendMetric] of [
  ['tsl-webgpu-baseline', 'backendWebGpu'],
  ['tsl-webgl2-baseline', 'backendWebGl2'],
] as const) {
  const result = await runRegisteredBenchmark({
    targetId,
    scenarioId: 'tsl-shader-baseline',
    input: {},
    controls: { dpr: 1, samples: 3, warmup: 1 },
    environment,
  });
  if (
    result.status !== 'passed' ||
    result.measurements.length !== 3 ||
    result.measurements.some(
      (measurement: BenchmarkMeasurement) =>
        measurement.outputBytes !== 64 ||
        measurement.hash !== expectedHash ||
        measurement.metrics?.[backendMetric] !== 1 ||
        measurement.metrics.pixelCount !== 16 ||
        measurement.metrics.exactRedPixels !== 16,
    )
  ) {
    throw new Error(`${targetId} did not preserve its exact TSL renderer contract`);
  }
  console.log(
    'tsl-renderer-ready',
    JSON.stringify({
      targetId,
      hash: result.measurements[0]?.hash,
      validation: result.validation,
    }),
  );
}

export {};
