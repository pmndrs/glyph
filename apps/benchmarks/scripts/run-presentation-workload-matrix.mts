/* @workflow { "name": "benchmark:presentation", "summary": "Render selected or every workload through Bitmap, MTSDF, and Slug on WebGPU and WebGL2.", "requirements": "GPU-enabled Chromium and authenticated benchmark fixtures. Pass --typegpu to exercise /three/typegpu; --workload, --technique, and --backend select a focused cell.", "writes": "Ignored browser caches only." } */
import { runPresentationProbeMatrix } from './support/run-presentation-probe-matrix.mts';

const selectedBackend = selectedArgument('--backend', ['webgpu', 'webgl2'] as const);
const selectedTechnique = selectedArgument('--technique', ['bitmap', 'mtsdf', 'slug'] as const);
const workload = selectedArgument('--workload', [
  'editorial',
  'text-ladder',
  'zoom-text',
  'icon-grid',
  'billboard-labels',
  'off-axis-3d',
  'dynamic-layout',
  'paragraph-stress',
  'paint-effects',
  'rich-text',
] as const);
const backends = selectedBackend === undefined ? (['webgpu', 'webgl2'] as const) : [selectedBackend];
const techniques = selectedTechnique === undefined ? (['bitmap', 'mtsdf', 'slug'] as const) : [selectedTechnique];
const shaders = process.argv.includes('--typegpu') ? 'typegpu' : 'tsl';

await runPresentationProbeMatrix({
  cases: backends.flatMap((backend) => techniques.map((technique) => ({ backend, technique }))),
  environment: {
    PRESENTATION_SHADERS: shaders,
    ...(workload === undefined ? {} : { PRESENTATION_WORKLOAD: workload }),
  },
  label: `sequential workloads / ${shaders}`,
  script: new URL('./run-presentation-workload-probe.mts', import.meta.url),
});

function selectedArgument<const Values extends readonly string[]>(
  name: string,
  values: Values,
): Values[number] | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  const selected = values.find((candidate) => candidate === value);
  if (selected === undefined) {
    throw new RangeError(`${name} must be one of ${values.join(', ')}`);
  }
  return selected;
}
