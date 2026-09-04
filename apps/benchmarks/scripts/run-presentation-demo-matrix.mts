/* @workflow { "name": "benchmark:demo", "summary": "Run the complete timed Presentation demo on WebGPU and WebGL2.", "requirements": "GPU-enabled Chromium and authenticated benchmark fixtures.", "writes": "Ignored browser caches only." } */
import { runPresentationProbeMatrix } from './support/run-presentation-probe-matrix.mts';

await runPresentationProbeMatrix({
  cases: [{ backend: 'webgpu' }, { backend: 'webgl2' }],
  label: 'timed demo',
  script: new URL('./run-presentation-demo-probe.mts', import.meta.url),
});
