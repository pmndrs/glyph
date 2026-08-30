/* @workflow {
  "name": "glyph:retained-batch-benchmark",
  "summary": "Measures same-frame updates across many retained Text instances in one Three TextGroup.",
  "requirements": "Built package: pnpm --filter @pmndrs/glyph build. Accepts --texts, --reps, and --warmup.",
  "writes": "stdout only"
} */
import { Text, TextGroup } from '../dist/three.js';

import { loadParagraphBenchmarkFixture } from './support/paragraph-benchmark-fixture.mts';

const options = parseArguments(process.argv.slice(2));
const fixture = await loadParagraphBenchmarkFixture();
const reports: Array<Readonly<{ texts: number; medianMs: number; p95Ms: number; perTextUs: number }>> = [];

try {
  for (const count of options.counts) reports.push(measureBatch(count));
} finally {
  fixture.loaded.dispose();
  fixture.loader.dispose();
}

console.log('\nretained texts     median        p95   per text');
for (const report of reports) {
  console.log(
    `${String(report.texts).padStart(14)}${`${report.medianMs.toFixed(2)}ms`.padStart(11)}${`${report.p95Ms.toFixed(2)}ms`.padStart(11)}${`${report.perTextUs.toFixed(2)}us`.padStart(11)}`,
  );
}

function measureBatch(count: number) {
  const group = new TextGroup({ capacity: { size: count * 16, policy: 'grow' } });
  const texts = Array.from(
    { length: count },
    (_, index) =>
      new Text({
        font: fixture.loaded,
        text: `alpha ${index}`,
        style: { fontSize: 16 },
        layout: { wrap: 'word' },
        constraints: { width: { mode: 'exact', size: 160 } },
      }),
  );
  group.add(...texts);
  group.updateMatrixWorld(true);
  if (group.error !== undefined) throw group.error;
  const samples: number[] = [];
  try {
    for (let repetition = 0; repetition < options.warmup + options.repetitions; repetition += 1) {
      const prefix = repetition % 2 === 0 ? 'bravo' : 'alpha';
      const started = performance.now();
      for (const [index, text] of texts.entries()) text.text = `${prefix} ${index}`;
      group.updateMatrixWorld(true);
      const duration = performance.now() - started;
      if (group.error !== undefined) throw group.error;
      if (repetition >= options.warmup) samples.push(duration);
    }
  } finally {
    group.dispose();
    for (const text of texts) text.dispose();
  }
  samples.sort((left, right) => left - right);
  const medianMs = percentile(samples, 0.5);
  return {
    texts: count,
    medianMs,
    p95Ms: percentile(samples, 0.95),
    perTextUs: (medianMs * 1000) / count,
  };
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
