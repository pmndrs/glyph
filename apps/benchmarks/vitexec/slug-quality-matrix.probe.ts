export {};

const executionPath = '/src/benchmark/execution.ts';
const environmentPath = '/src/benchmark/environment.ts';
const fixturesPath = '/src/benchmark/font-fixtures.ts';
const [{ runRegisteredBenchmark }, { environmentResource }, { ADVANCED_FONT_FIXTURES }] = await Promise.all([
  import(/* @vite-ignore */ executionPath),
  import(/* @vite-ignore */ environmentPath),
  import(/* @vite-ignore */ fixturesPath),
]);

const environment = await environmentResource();
const observations: Array<Record<string, unknown>> = [];

for (const backend of ['webgpu', 'webgl2'] as const) {
  for (const dpr of [1, 2] as const) {
    for (const { id: fontFixture } of ADVANCED_FONT_FIXTURES) {
      console.log('slug-quality-selecting', backend, dpr, fontFixture);
      const controls = { dpr, samples: 1, warmup: 0 };
      const input = { fontFixture };
      const sampling = await runRegisteredBenchmark({
        targetId: `slug-conformance-${backend}`,
        scenarioId: 'slug-sampling-conformance',
        input,
        controls,
        environment,
      });
      const sourceOutline = await runRegisteredBenchmark({
        targetId: `source-outline-slug-${backend}`,
        scenarioId: 'source-outline-fidelity',
        input,
        controls,
        environment,
      });
      observations.push({
        backend,
        dpr,
        fontFixture,
        sampling: result(sampling),
        sourceOutline: result(sourceOutline),
      });
      console.log('slug-quality-observed', backend, dpr, fontFixture);
    }
  }
}

console.log(
  'slug-quality-matrix-ready',
  JSON.stringify({
    schemaVersion: 0,
    kind: 'slug-quality-matrix-observation',
    capturedAt: new Date().toISOString(),
    environment,
    observations,
  }),
);

function result(summary: {
  readonly status: string;
  readonly validation: string;
  readonly medianMs: number;
  readonly measurements: readonly {
    readonly hash: string;
    readonly outputBytes: number;
    readonly metrics?: Readonly<Record<string, number>>;
  }[];
}): Record<string, unknown> {
  if (summary.status !== 'passed') throw new Error('Slug quality matrix contains a failed summary');
  const measurement = summary.measurements[0];
  if (measurement === undefined) throw new Error('Slug quality matrix omitted its measurement');
  return {
    hash: measurement.hash,
    outputBytes: measurement.outputBytes,
    durationMs: summary.medianMs,
    validation: summary.validation,
    metrics: measurement.metrics,
  };
}
