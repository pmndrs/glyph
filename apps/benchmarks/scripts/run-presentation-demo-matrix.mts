import { runPresentationProbeMatrix } from './support/run-presentation-probe-matrix.mts';

await runPresentationProbeMatrix({
  cases: [{ backend: 'webgpu' }, { backend: 'webgl2' }],
  label: 'timed demo',
  script: new URL('./run-presentation-demo-probe.mts', import.meta.url),
});
