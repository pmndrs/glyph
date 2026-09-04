/* @workflow { "name": "benchmark:presentation", "summary": "Render every workload through Bitmap, MTSDF, and Slug on WebGPU and WebGL2.", "requirements": "GPU-enabled Chromium and authenticated benchmark fixtures.", "writes": "Ignored browser caches only." } */
import { runPresentationProbeMatrix } from './support/run-presentation-probe-matrix.mts';

const backends = ['webgpu', 'webgl2'] as const;
const techniques = ['bitmap', 'mtsdf', 'slug'] as const;

await runPresentationProbeMatrix({
  cases: backends.flatMap((backend) => techniques.map((technique) => ({ backend, technique }))),
  label: 'sequential workloads',
  script: new URL('./run-presentation-workload-probe.mts', import.meta.url),
});
