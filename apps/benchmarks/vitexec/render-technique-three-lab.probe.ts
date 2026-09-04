/* @workflow { "name": "benchmark:render-technique-lab", "summary": "Measure generic and first-party Three plan realization and retained updates.", "requirements": "Built Glyph and glyph-example packages, project Chromium, and the authenticated Inter fixture.", "writes": "stdout only" } */
const labPath = '/src/benchmark/labs/render-technique-three.ts';
const { runRenderTechniqueThreeLab } = await import(/* @vite-ignore */ labPath);
const report = await runRenderTechniqueThreeLab();
if (
  report.generic.draws !== 1 ||
  report.bitmap.draws !== 1 ||
  report.generic.instances < 1 ||
  report.bitmap.instances < 1 ||
  report.generic.instances !== report.bitmap.instances ||
  !report.generic.retainedGeometry ||
  !report.bitmap.retainedGeometry ||
  !Number.isFinite(report.warmMedianRatio)
) {
  throw new Error('Three render-technique lab did not preserve its realization invariants');
}
console.log('render-technique-three-lab-ready', JSON.stringify(report));

export {};
