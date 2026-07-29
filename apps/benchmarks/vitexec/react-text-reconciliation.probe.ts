import type { BenchmarkMeasurement } from '../src/benchmark/contracts';

const executionPath = '/src/benchmark/execution.ts';
const environmentPath = '/src/benchmark/environment.ts';
const [{ runRegisteredBenchmark }, { environmentResource }] = await Promise.all([
  import(/* @vite-ignore */ executionPath),
  import(/* @vite-ignore */ environmentPath),
]);

const result = await runRegisteredBenchmark({
  targetId: 'react-text-reconciliation',
  scenarioId: 'react-text-reconciliation',
  input: {},
  controls: { dpr: 1, samples: 3, warmup: 1 },
  environment: await environmentResource(),
});

if (
  result.status !== 'passed' ||
  result.measurements.length !== 3 ||
  result.measurements.some(
    (measurement: BenchmarkMeasurement) =>
      measurement.metrics?.coreObjectRetained !== 1 ||
      measurement.metrics.nestedSpanCount !== 1 ||
      measurement.metrics.glyphCount !== 55 ||
      measurement.metrics.drawCount !== 1 ||
      measurement.metrics.paintCount !== 2 ||
      measurement.metrics.widthReflowed !== 1 ||
      measurement.metrics.layoutRestored !== 1 ||
      measurement.metrics.oracleNaturalMatched !== 1 ||
      measurement.metrics.oracleNarrowMatched !== 1 ||
      typeof measurement.metrics.r3fDrawCalls !== 'number' ||
      measurement.metrics.r3fDrawCalls < 1,
  )
) {
  throw new Error('registered React Text target did not preserve its reconciliation contract');
}

console.log(
  'react-text-reconciliation-ready',
  JSON.stringify({ hash: result.measurements[0]?.hash, validation: result.validation }),
);

export {};
