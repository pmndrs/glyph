/* @workflow {
  "name": "glyph:retained-batch-benchmark",
  "summary": "Measures same-frame updates and draw batching across many retained Text instances in nested Three TextGroups.",
  "requirements": "Built package: pnpm --filter @pmndrs/glyph build. Accepts --texts, --reps, and --warmup.",
  "writes": "stdout only"
} */
import * as THREE from 'three/webgpu';

import { loadParagraphBenchmarkFixture } from './support/paragraph-benchmark-fixture.mts';

const options = parseArguments(process.argv.slice(2));
const fixture = await loadParagraphBenchmarkFixture();
const reports: Array<
  Readonly<{ texts: number; draws: number; glyphs: number; medianMs: number; p95Ms: number; perTextUs: number }>
> = [];

try {
  for (const count of options.counts) reports.push(measureBatch(count));
} finally {
  fixture.dispose();
}

console.log('\nretained texts  draws  glyphs     median        p95   per text');
for (const report of reports) {
  console.log(
    `${String(report.texts).padStart(14)}${String(report.draws).padStart(7)}${String(report.glyphs).padStart(8)}${`${report.medianMs.toFixed(2)}ms`.padStart(11)}${`${report.p95Ms.toFixed(2)}ms`.padStart(11)}${`${report.perTextUs.toFixed(2)}us`.padStart(11)}`,
  );
}

function measureBatch(count: number) {
  const root = fixture.root();
  root.setCapacity({ size: count * 16, policy: 'grow' });
  const group = root.createTextGroup();
  const nestedGroup = root.createTextGroup();
  const texts = Array.from({ length: count }, (_, index) =>
    root.createText({
      font: fixture.loaded,
      text: `alpha ${index}`,
      style: { fontSize: 16 },
      layout: { wrap: 'word' },
      constraints: { width: { mode: 'exact', size: 160 } },
    }),
  );
  nestedGroup.position.set(8, 12, 0);
  nestedGroup.add(...texts);
  group.add(nestedGroup);
  const scene = new THREE.Scene();
  scene.add(group);
  scene.updateMatrixWorld(true);
  if (group.error !== undefined) throw group.error;
  if (nestedGroup.error !== undefined) throw nestedGroup.error;
  if (group.textCount !== count || nestedGroup.textCount !== count) {
    throw new Error('nested TextGroups did not retain every benchmark Text descendant');
  }
  const initialDraws = inspectDraws(root.drawRoot);
  if (initialDraws.draws !== 1) {
    throw new Error(`one compatible TextGroup batch realized ${String(initialDraws.draws)} draws instead of 1`);
  }
  const samples: number[] = [];
  try {
    for (let repetition = 0; repetition < options.warmup + options.repetitions; repetition += 1) {
      const prefix = repetition % 2 === 0 ? 'bravo' : 'alpha';
      const started = performance.now();
      for (const [index, text] of texts.entries()) text.text = `${prefix} ${index}`;
      scene.updateMatrixWorld(true);
      const duration = performance.now() - started;
      if (group.error !== undefined) throw group.error;
      if (nestedGroup.error !== undefined) throw nestedGroup.error;
      const currentDraws = inspectDraws(root.drawRoot);
      if (currentDraws.draws !== initialDraws.draws || currentDraws.glyphs !== initialDraws.glyphs) {
        throw new Error('a retained TextGroup update changed the realized batch shape');
      }
      if (repetition >= options.warmup) samples.push(duration);
    }
  } finally {
    group.dispose();
    nestedGroup.dispose();
    for (const text of texts) text.dispose();
    root.dispose();
  }
  samples.sort((left, right) => left - right);
  const medianMs = percentile(samples, 0.5);
  return {
    texts: count,
    draws: initialDraws.draws,
    glyphs: initialDraws.glyphs,
    medianMs,
    p95Ms: percentile(samples, 0.95),
    perTextUs: (medianMs * 1000) / count,
  };
}

function inspectDraws(drawRoot: THREE.Object3D): Readonly<{ draws: number; glyphs: number }> {
  let draws = 0;
  let glyphs = 0;
  drawRoot.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    draws += 1;
    if (object.geometry instanceof THREE.InstancedBufferGeometry) glyphs += object.geometry.instanceCount;
  });
  return { draws, glyphs };
}

function percentile(sorted: readonly number[], quantile: number): number {
  const value = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))];
  if (value === undefined) throw new Error('retained batch benchmark produced no samples');
  return value;
}

function parseArguments(argv: readonly string[]) {
  const read = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const counts = (read('--texts') ?? '64,128,256,512').split(',').map((value) => Number.parseInt(value, 10));
  const repetitions = Number.parseInt(read('--reps') ?? '15', 10);
  const warmup = Number.parseInt(read('--warmup') ?? '5', 10);
  if (counts.some((count) => !Number.isSafeInteger(count) || count <= 0)) {
    throw new RangeError('--texts must contain positive integers');
  }
  if (!Number.isSafeInteger(repetitions) || repetitions <= 0) throw new RangeError('--reps must be positive');
  if (!Number.isSafeInteger(warmup) || warmup < 0) throw new RangeError('--warmup must be nonnegative');
  return { counts, repetitions, warmup };
}
