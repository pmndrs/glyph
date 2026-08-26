/* @workflow {
  "name": "glyph:layout-benchmark",
  "summary": "Measures public TextGroup updates externally through Rust text_update and Three render-plan application.",
  "requirements": "Built package: pnpm --filter @pmndrs/glyph build. Accepts --glyphs, --reps, --warmup, --case, --json.",
  "writes": "stdout only, or the JSON report path passed to --json"
} */
import { writeFile } from 'node:fs/promises';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import {
  createBenchmarkParagraph,
  disposeBenchmarkParagraph,
  loadParagraphBenchmarkFixture,
  paragraphTextForGlyphs,
} from './support/paragraph-benchmark-fixture.mts';

/**
 * Answers one question: how long does a paragraph batch take to reach uploadable instance data, per glyph, at the sizes
 * an editorial page actually reaches.
 *
 * Every number here is a median of repetitions taken after the measured code has been warmed, because a first call
 * measures the optimizing compiler rather than the algorithm. The report carries the relative standard deviation beside
 * each median so a reader can tell a real change from sampling noise. This outside-only workflow deliberately owns one
 * host timer around the complete public update. `benchmark:paragraph-stress-timing` owns browser phase attribution.
 *
 * The cases are kept apart rather than averaged. They invalidate different caches: a size change reuses the shaped run
 * and recomputes every measurement, a width change reuses shaping and measurement and replans lines, and a text change
 * reshapes. Averaging them would hide whichever one is slow.
 */

const budget60 = 1000 / 60;
const budget120 = 1000 / 120;

/** Repetitions discarded before recording, so the measured code is optimized rather than interpreted. */
const DEFAULT_WARMUP = 8;
/** Recorded repetitions per case. Odd, so the median is a measured sample rather than an interpolation. */
const DEFAULT_REPETITIONS = 31;
/** Glyph counts to sweep. The largest is past four columns of six thousand, which is the stated worst case. */
const DEFAULT_SCALES = [5_500, 11_000, 22_000, 33_000] as const;

type CaseName = 'cold' | 'font-size' | 'layout-width' | 'text';

interface UpdateProfile {
  readonly wallMs: number;
}

interface Sample extends UpdateProfile {
  readonly glyphs: number;
}

interface CaseReport {
  readonly name: CaseName;
  readonly glyphs: number;
  readonly medianMs: number;
  readonly meanMs: number;
  readonly minMs: number;
  readonly p95Ms: number;
  /** Relative standard deviation of the recorded repetitions. Above roughly 10% the median is not yet trustworthy. */
  readonly rsdPercent: number;
  readonly perGlyphUs: number;
  readonly bytesPerUpdate: number;
}

const options = parseArguments(process.argv.slice(2));
const collectGarbage = exposeGarbageCollection();

const font = await loadParagraphBenchmarkFixture();
const reports: CaseReport[] = [];

for (const targetGlyphs of options.scales) {
  const text = paragraphTextForGlyphs(targetGlyphs);
  for (const name of options.cases) {
    reports.push(await measureCase(name, text));
  }
}

printReport(reports);
if (options.jsonPath !== undefined) {
  await writeFile(options.jsonPath, `${JSON.stringify({ generatedBy: 'glyph:layout-benchmark', reports }, null, 2)}\n`);
  console.log(`\nwrote ${options.jsonPath}`);
}

font.loaded.dispose();
font.runtime.dispose();

async function measureCase(name: CaseName, text: string): Promise<CaseReport> {
  const total = options.warmup + options.repetitions;
  const samples: Sample[] = [];
  // A cold case must build a fresh batch every repetition; the others measure an update to a warm one, which is what a
  // frame actually does. Both still run the same warmup discipline.
  const heapDeltas: number[] = [];
  const counter = createBenchmarkParagraph(font, text, 600);
  counter.group.updateMatrixWorld(true);
  if (counter.group.error !== undefined) throw counter.group.error;
  const calibratedGlyphs = counter.paragraph.layout().glyphCount;
  disposeBenchmarkParagraph(counter);
  const warm = name === 'cold' ? undefined : createBenchmarkParagraph(font, text, 600);
  if (warm !== undefined) {
    warm.group.updateMatrixWorld(true);
    if (warm.group.error !== undefined) throw warm.group.error;
  }

  for (let repetition = 0; repetition < total; repetition += 1) {
    const recording = repetition >= options.warmup;

    const created = name === 'cold' ? createBenchmarkParagraph(font, text, 600) : undefined;
    if (warm !== undefined) applyChange(name, warm.paragraph, repetition, text);

    collectGarbage();
    const heapBefore = process.memoryUsage().heapUsed;
    const updated = created ?? warm!;
    const profile = profileUpdate(() => updated.group.updateMatrixWorld(true));
    const heapAfter = process.memoryUsage().heapUsed;

    if (updated.group.error !== undefined) throw updated.group.error;
    if (created !== undefined) disposeBenchmarkParagraph(created);

    if (recording) {
      samples.push({ ...profile, glyphs: calibratedGlyphs });
      heapDeltas.push(Math.max(0, heapAfter - heapBefore));
    }
  }

  if (warm !== undefined) disposeBenchmarkParagraph(warm);

  const durations = sorted(samples, 'wallMs');
  const glyphs = samples[0]?.glyphs ?? 0;
  const mean = durations.reduce((sum, value) => sum + value, 0) / durations.length;
  const variance = durations.reduce((sum, value) => sum + (value - mean) ** 2, 0) / durations.length;
  const median = durations[Math.floor(durations.length / 2)] ?? 0;
  const bytes = heapDeltas.reduce((sum, value) => sum + value, 0) / Math.max(1, heapDeltas.length);

  return {
    name,
    glyphs,
    medianMs: median,
    meanMs: mean,
    minMs: durations[0] ?? 0,
    p95Ms: durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))] ?? 0,
    rsdPercent: mean === 0 ? 0 : (Math.sqrt(variance) / mean) * 100,
    perGlyphUs: glyphs === 0 ? 0 : (median * 1000) / glyphs,
    bytesPerUpdate: bytes,
  };
}

function profileUpdate(update: () => void): UpdateProfile {
  const started = performance.now();
  update();
  return { wallMs: performance.now() - started };
}

function sorted<Key extends keyof UpdateProfile>(samples: readonly Sample[], key: Key): number[] {
  return samples.map((sample) => sample[key]).sort((left, right) => left - right);
}

function applyChange(name: CaseName, paragraph: ParagraphHandle, repetition: number, text: string): void {
  // Every repetition applies a value no earlier repetition used, so a retained per-constraint cache can never answer a
  // measured update. A repeating cycle would let the cache serve part of the run and report a median that no drag,
  // resize, or edit ever experiences.
  if (name === 'font-size') paragraph.style = { fontSize: 12 + repetition * 0.5 };
  else if (name === 'layout-width') {
    paragraph.contentBox = { width: { mode: 'exact', size: 420 + repetition * 7 }, wrap: 'word' };
  } else paragraph.text = `${text.slice(0, text.length - repetition)}`;
}

type ParagraphHandle = ReturnType<typeof createBenchmarkParagraph>['paragraph'];

function printReport(rows: readonly CaseReport[]): void {
  console.log(
    `\nwarmup ${options.warmup} discarded · ${options.repetitions} recorded repetitions · budget ${budget60.toFixed(2)}ms @60Hz · ${budget120.toFixed(2)}ms @120Hz\n`,
  );
  console.log(
    `${'case'.padEnd(13)}${'glyphs'.padStart(8)}${'outside'.padStart(10)}${'p95'.padStart(11)}${'min'.padStart(10)}${'rsd'.padStart(7)}  budget`,
  );
  for (const row of rows) {
    const over = row.medianMs / budget120;
    console.log(
      `${row.name.padEnd(13)}${String(row.glyphs).padStart(8)}${`${row.medianMs.toFixed(2)}ms`.padStart(10)}${`${row.p95Ms.toFixed(2)}ms`.padStart(11)}${`${row.minMs.toFixed(2)}ms`.padStart(10)}${`${row.rsdPercent.toFixed(1)}%`.padStart(7)}  ${over <= 1 ? 'within 120Hz' : `${over.toFixed(1)}x over 120Hz`}`,
    );
  }
  console.log('\nThis public Three diagnostic is not the canonical Rust-vs-TypeScript comparison.');
  console.log('Use glyph:rust-layout-benchmark for the unchanged complete text_update + render-plan metric.');
}

function parseArguments(argv: readonly string[]) {
  const read = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const scales = read('--glyphs');
  const cases = read('--case');
  return {
    scales: scales === undefined ? DEFAULT_SCALES : scales.split(',').map((value) => Number.parseInt(value, 10)),
    cases: (cases === undefined ? ['cold', 'font-size', 'layout-width', 'text'] : cases.split(',')) as CaseName[],
    warmup: Number.parseInt(read('--warmup') ?? String(DEFAULT_WARMUP), 10),
    repetitions: Number.parseInt(read('--reps') ?? String(DEFAULT_REPETITIONS), 10),
    jsonPath: read('--json'),
  };
}

/**
 * Allocation per update is only meaningful against a collected heap, and the workflow runner cannot pass a node flag
 * ahead of the script. Enabling the flag in-process avoids a respawn while keeping the measurement honest.
 */
function exposeGarbageCollection(): () => void {
  if (typeof globalThis.gc === 'function') return globalThis.gc;
  setFlagsFromString('--expose-gc');
  const collect = runInNewContext('gc') as unknown;
  setFlagsFromString('--no-expose-gc');
  return typeof collect === 'function' ? (collect as () => void) : () => {};
}
