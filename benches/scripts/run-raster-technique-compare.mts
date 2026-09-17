/* @workflow { "name": "benchmark:raster-comparison", "summary": "Run the finite MSDF and Slug sampling conformance targets on both renderer backends.", "requirements": "Built runtime packages plus GPU-enabled Playwright Chromium and authenticated benchmark fixtures.", "writes": "Standard output only." } */
import { runNodeScript } from './support/command-cli.mts';

const cases = [
  ['mtsdf-conformance-webgpu', 'mtsdf-sampling-conformance'],
  ['mtsdf-conformance-webgl2', 'mtsdf-sampling-conformance'],
  ['slug-conformance-webgpu', 'slug-sampling-conformance'],
  ['slug-conformance-webgl2', 'slug-sampling-conformance'],
] as const;

for (const [target, scenario] of cases) {
  await runNodeScript('scripts/run-headless.mts', [
    '--target',
    target,
    '--scenario',
    scenario,
    '--gpu',
    'true',
    ...process.argv.slice(2),
  ]);
}
