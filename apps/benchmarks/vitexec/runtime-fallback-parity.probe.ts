export {};

const executionPath = '/src/benchmark/execution.ts';
const environmentPath = '/src/benchmark/environment.ts';
const [{ runRegisteredBenchmark }, { environmentResource }] = await Promise.all([
  import(/* @vite-ignore */ executionPath),
  import(/* @vite-ignore */ environmentPath),
]);

// The headless conformance suite always runs baked delivery, so this is the only lane that proves a source-font
// runtime bake reaches the same pixels as the checked-in baked asset through the same public loading path.
for (const technique of ['bitmap', 'mtsdf', 'slug'] as const) {
  const summary = await runRegisteredBenchmark({
    targetId: `runtime-fallback-${technique}-webgpu`,
    scenarioId: 'runtime-fallback-parity',
    input: { fontFixture: 'inter' },
    controls: { dpr: 1, samples: 1, warmup: 0 },
    environment: await environmentResource(),
  });
  const metrics = summary.measurements[0]?.metrics;
  console.log(
    `${technique}: ${summary.status} · ${summary.validation} · mismatchBytes=${String(
      metrics?.mismatchBytes,
    )} changedPixels=${String(metrics?.changedPixels)} maximumError=${String(metrics?.maximumError)}`,
  );
  if (summary.status !== 'passed' || metrics?.mismatchBytes !== 0 || metrics.changedPixels !== 0) {
    throw new Error(`${technique} runtime-baked rendering diverged from the checked-in baked asset`);
  }
}

console.log('runtime-fallback-parity-probe-ready');
/* @workflow
{
  "name": "benchmark:runtime-fallback",
  "summary": "Verify exact Bitmap, MTSDF, and Slug baked/runtime delivery parity on hardware WebGPU.",
  "requirements": "GPU-enabled Chromium and Vitexec; runs a cold source-font core and raster bake per technique.",
  "writes": "Ignored browser caches only.",
  "args": ["--gpu", "--path", "/?runner=probe"]
}
*/
