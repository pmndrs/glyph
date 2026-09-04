/* @workflow { "name": "benchmark:presentation-screenshots", "summary": "Capture verified Presentation screenshots for every workload and backend.", "requirements": "GPU-enabled Chromium and authenticated benchmark fixtures.", "writes": "Ignored apps/benchmarks/.cache/presentation-screenshots files." } */
process.env.PRESENTATION_SCREENSHOT_DIR ??= './.cache/presentation-screenshots';

const { runPresentationProbeMatrix } = await import('./support/run-presentation-probe-matrix.mts');

await runPresentationProbeMatrix({
  cases: [
    { backend: 'webgpu', technique: 'mtsdf' },
    { backend: 'webgl2', technique: 'mtsdf' },
  ],
  label: 'presentation screenshot',
  script: new URL('./run-presentation-workload-probe.mts', import.meta.url),
});
