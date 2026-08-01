import { runPresentationProbeMatrix } from './support/run-presentation-probe-matrix.mts';

const backends = ['webgpu', 'webgl2'] as const;
const techniques = ['bitmap', 'mtsdf', 'slug'] as const;

await runPresentationProbeMatrix({
  cases: backends.flatMap((backend) => techniques.map((technique) => ({ backend, technique }))),
  label: 'sequential workloads',
  script: new URL('./run-presentation-workload-probe.mts', import.meta.url),
});
