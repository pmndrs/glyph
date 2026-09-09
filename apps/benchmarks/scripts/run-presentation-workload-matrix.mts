/* @workflow { "name": "benchmark:presentation", "summary": "Render every workload through Bitmap, MTSDF, and Slug on WebGPU and WebGL2.", "requirements": "GPU-enabled Chromium and authenticated benchmark fixtures. Pass --typegpu to exercise /three/typegpu.", "writes": "Ignored browser caches only." } */
import { runPresentationProbeMatrix } from './support/run-presentation-probe-matrix.mts';

const backends = ['webgpu', 'webgl2'] as const;
const techniques = ['bitmap', 'mtsdf', 'slug'] as const;
const shaders = process.argv.includes('--typegpu') ? 'typegpu' : 'tsl';

await runPresentationProbeMatrix({
  cases: backends.flatMap((backend) => techniques.map((technique) => ({ backend, technique }))),
  environment: { PRESENTATION_SHADERS: shaders },
  label: `sequential workloads / ${shaders}`,
  script: new URL('./run-presentation-workload-probe.mts', import.meta.url),
});
