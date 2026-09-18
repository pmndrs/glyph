/* @workflow {
  "name": "hero:retained-lines-check",
  "summary": "Compare every retained typing prefix with independently shaped feature and robot text layouts.",
  "requirements": "Workspace dependencies, baked hero assets, and GPU-enabled Chromium through Vitexec.",
  "writes": "Layout comparison results to stdout",
  "args": ["--gpu", "--timeout", "120"]
} */
import { _roots } from '@react-three/fiber/webgpu';
import { Text } from '@pmndrs/glyph/three';
import { Matrix4, WebGPUBackend, WebGPURenderer } from 'three/webgpu';

const { createRetainedLine, showLine, resetLine, disposeLine } = (await import(
  new URL('/src/scene/retained-line.ts', location.origin).href
)) as typeof import('../src/scene/retained-line');
while (document.documentElement.dataset.heroState !== 'ready')
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const state = _roots.values().next().value!.store.getState();
state.setFrameloop('never');
if (!(state.renderer instanceof WebGPURenderer) || !(state.renderer.backend instanceof WebGPUBackend))
  throw new Error('Retained line proof requires WebGPU');
const sources: Parameters<typeof createRetainedLine>[0][] = [];
state.scene.traverse((object) => {
  if (object instanceof Text && (object.text.startsWith('SHAPING') || object.text === 'PMNDRS')) sources.push(object);
});
if (sources.length !== 2) throw new Error(`Expected both typing lines, found ${sources.length}`);
let compared = 0;
let maxError = 0;
const matrix = new Matrix4();
for (const source of sources) {
  const full = source.text;
  const line = createRetainedLine(source);
  try {
    for (let count = 0; count <= full.length; count++) {
      showLine(line, count);
      source.text = full.slice(0, count);
      const oracle = source.glyphs();
      for (const glyph of line.glyphs.measurements) {
        const cluster = line.glyphs.glyphAt(glyph.index)!.cluster;
        line.glyphs.getMatrixAt(glyph.index, matrix);
        if (cluster >= count) {
          if (matrix.elements[0] !== 0 || matrix.elements[5] !== 0) throw new Error('Untyped glyph was not hidden');
          continue;
        }
        const index = oracle.clusters.indexOf(cluster);
        if (index < 0) throw new Error(`Missing oracle cluster ${cluster}`);
        const error = Math.max(
          Math.abs(matrix.elements[12]! - oracle.x[index]!),
          Math.abs(matrix.elements[13]! + oracle.y[index]!),
        );
        maxError = Math.max(maxError, error);
        if (error > 0.00001)
          throw new Error(
            `Typing layout changed: ${JSON.stringify({ text: full, count, cluster, error, actual: matrix.elements.slice(12, 14), expected: [oracle.x[index], -oracle.y[index]!] })}`,
          );
        compared++;
      }
    }
    line.glyphs.setMatrixAt(0, new Matrix4().makeTranslation(500, 500, 0));
    resetLine(line, full.length);
    line.glyphs.getMatrixAt(0, matrix);
    if (!matrix.equals(line.glyphs.measurements[0]!.originalMatrix))
      throw new Error('Replay did not restore the original glyph transform');
  } finally {
    source.text = full;
    disposeLine(line);
  }
}
console.log('hero-retained-lines-ready', JSON.stringify({ compared, maxError }));
