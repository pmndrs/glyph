/* @workflow
{
  "name": "benchmark:raster-comparison",
  "summary": "Verify retained MSDF/Slug comparison and exclusive finite-capture recovery on both backends.",
  "requirements": "GPU-enabled Chromium and Vitexec.",
  "writes": "Ignored browser caches only."
}
*/
import { runVitexec } from './support/command-cli.mts';

const paths = [
  '/?mode=conformance&technique=msdf&backend=webgpu&delivery=baked&dpr=1&font=inter&workload=mtsdf-slug-compare',
  '/?mode=conformance&technique=msdf&backend=webgl2&delivery=baked&dpr=1&font=inter&workload=mtsdf-slug-compare',
] as const;

for (const path of paths) {
  await runVitexec(['--gpu', '--path', path, './vitexec/raster-technique-compare.probe.ts', ...process.argv.slice(2)]);
}
