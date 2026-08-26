/* @workflow {
  "name": "benchmark:render-technique-typegpu",
  "summary": "Render and update the external example technique through TypeGPU and WebGPU pixel readback.",
  "args": ["--gpu"],
  "requirements": "Built Glyph and glyph-example packages, project Chromium with WebGPU, and the authenticated Inter fixture.",
  "writes": "stdout only"
} */
const labPath = '/src/benchmark/labs/render-technique-typegpu.ts';
const { runRenderTechniqueTypeGpuLab } = await import(/* @vite-ignore */ labPath);
const report = await runRenderTechniqueTypeGpuLab();
if (
  report.initialDraws < 1 ||
  report.updatedDraws < 1 ||
  report.initialVisiblePixels < 1 ||
  report.updatedVisiblePixels < 1 ||
  report.changedPixels < 1 ||
  report.idleGpuSubmissions !== 0 ||
  report.clearGpuSubmissions !== 1
) {
  throw new Error('TypeGPU render-technique lab did not preserve its draw and pixel invariants');
}
console.log('render-technique-typegpu-lab-ready', JSON.stringify(report));

export {};
