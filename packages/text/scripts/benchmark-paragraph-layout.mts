/* @workflow {
  "name": "text:layout-benchmark",
  "summary": "Measures paragraph preparation, layout, and packing cost per glyph across realistic scales, with phase attribution and allocation.",
  "requirements": "Built package: pnpm --filter @pmndrs/text build. Accepts --glyphs, --reps, --warmup, --case, --json.",
  "writes": "stdout only, or the JSON report path passed to --json"
} */
import { readFile, writeFile } from 'node:fs/promises';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { createRuntimeShaper, createTextRuntime, FontRegistry } from '../dist/index.js';
import { bitmap } from '../dist/raster/bitmap-technique.js';

/**
 * Answers one question: how long does a paragraph batch take to reach uploadable instance data, per glyph, at the sizes
 * an editorial page actually reaches.
 *
 * Every number here is a median of repetitions taken after the measured code has been warmed, because a first call
 * measures the optimizing compiler rather than the algorithm. The report carries the relative standard deviation beside
 * each median so a reader can tell a real change from sampling noise, and the phase table attributes the median to the
 * pipeline stage that spent it, so an optimization is aimed rather than guessed.
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

const paragraphSource = [
  'Typography is a moving system. AVATAR To Wa Yo repeat familiar kerning pairs while a responsive panel changes the space around them. The quick visual check is useful, but the benchmark records the cost of shaping, layout, upload, and every rendered frame.',
  'A practical interface mixes prose with 0123456789, prices such as 24.50, ranges from 8-512 px, and punctuation-"quotes", (parentheses), brackets, commas, and semicolons. Repeated office, affine, difficult, and shuffle words retain ff, fi, fl, ffi, and ffl candidates.',
  'Scientific copy adds x2+y2~z2, 0<=a<=1, and pi. Arrows point both ways. These symbols expose missing coverage, uneven baselines, bad advances, and atlas placement errors that plain alphabet samples can hide.',
].join('\n');

type CaseName = 'cold' | 'font-size' | 'layout-width' | 'text';

interface Sample {
  readonly durationMs: number;
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

const root = new URL('../../../', import.meta.url);
const font = await loadFont();
const reports: CaseReport[] = [];

for (const targetGlyphs of options.scales) {
  const text = textForGlyphs(targetGlyphs);
  for (const name of options.cases) {
    reports.push(await measureCase(name, text));
  }
}

printReport(reports);
if (options.jsonPath !== undefined) {
  await writeFile(options.jsonPath, `${JSON.stringify({ generatedBy: 'text:layout-benchmark', reports }, null, 2)}\n`);
  console.log(`\nwrote ${options.jsonPath}`);
}

font.runtime.dispose();
font.loaded.dispose();

async function measureCase(name: CaseName, text: string): Promise<CaseReport> {
  const total = options.warmup + options.repetitions;
  const samples: Sample[] = [];
  const { runtime } = font;

  // A cold case must build a fresh batch every repetition; the others measure an update to a warm one, which is what a
  // frame actually does. Both still run the same warmup discipline.
  const heapDeltas: number[] = [];
  const warm = name === 'cold' ? undefined : createParagraph(runtime, text, 600);
  if (warm !== undefined) runtime.update();

  for (let repetition = 0; repetition < total; repetition += 1) {
    const recording = repetition >= options.warmup;

    const created = name === 'cold' ? createParagraph(runtime, text, 600) : undefined;
    if (warm !== undefined) applyChange(name, warm.paragraph, repetition, text);

    collectGarbage();
    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();
    runtime.update();
    const durationMs = performance.now() - started;
    const heapAfter = process.memoryUsage().heapUsed;

    const glyphs = glyphCount(created?.batch ?? warm!.batch);
    created?.batch.dispose();

    if (recording) {
      samples.push({ durationMs, glyphs });
      heapDeltas.push(Math.max(0, heapAfter - heapBefore));
    }
  }

  warm?.batch.dispose();

  const durations = samples.map((sample) => sample.durationMs).sort((left, right) => left - right);
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

function applyChange(name: CaseName, paragraph: ParagraphHandle, repetition: number, text: string): void {
  // Every repetition applies a value no earlier repetition used, so a retained per-constraint cache can never answer a
  // measured update. A repeating cycle would let the cache serve part of the run and report a median that no drag,
  // resize, or edit ever experiences.
  if (name === 'font-size') paragraph.style = { fontSize: 12 + repetition * 0.5 };
  else if (name === 'layout-width') {
    paragraph.contentBox = { width: { mode: 'exact', size: 420 + repetition * 7 }, wrap: 'word' };
  } else paragraph.text = `${text.slice(0, text.length - repetition)}`;
}

type TextRuntimeHandle = Awaited<ReturnType<typeof createTextRuntime>>;
type ParagraphBatchHandle = ReturnType<TextRuntimeHandle['createParagraphBatch']>;
type ParagraphHandle = ReturnType<ParagraphBatchHandle['add']>;

function createParagraph(runtime: TextRuntimeHandle, text: string, width: number) {
  const batch = runtime.createParagraphBatch({ technique: bitmap });
  const paragraph = batch.add({
    font: font.loaded,
    text,
    contentBox: { width: { mode: 'exact', size: width }, wrap: 'word' },
    style: { fontSize: 24 },
  });
  return { batch, paragraph };
}

function glyphCount(batch: ParagraphBatchHandle): number {
  let total = 0;
  for (const paragraph of batch.current.paragraphs) total += paragraph.layout.glyphIds.length;
  return total;
}

function textForGlyphs(target: number): string {
  // The source paragraph is measured once, then repeated to reach the target. Repetition keeps the shaping work
  // representative while making the scale exact enough to compare per-glyph costs across rows.
  const perCopy = paragraphSource.replaceAll(/\s/gu, '').length;
  const copies = Math.max(1, Math.round(target / perCopy));
  return Array.from({ length: copies }, () => paragraphSource).join('\n');
}

async function loadFont() {
  const registry = new FontRegistry();
  const shaper = await createRuntimeShaper({
    registry,
    wasm: await readFile(new URL('packages/text/dist/text_shaper.wasm', root)),
  });
  const runtime = await createTextRuntime({ registry, shaper });
  const bytes = await readFile(new URL('apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', root));
  const loaded = await runtime.loadFont({
    input: { baked: `data:application/octet-stream;base64,${bytes.toString('base64')}` },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  return { runtime, loaded };
}

function printReport(rows: readonly CaseReport[]): void {
  console.log(
    `\nwarmup ${options.warmup} discarded · ${options.repetitions} recorded repetitions · budget ${budget60.toFixed(2)}ms @60Hz · ${budget120.toFixed(2)}ms @120Hz\n`,
  );
  console.log(
    `${'case'.padEnd(13)}${'glyphs'.padStart(8)}${'median'.padStart(10)}${'p95'.padStart(10)}${'min'.padStart(9)}${'rsd'.padStart(7)}${'µs/glyph'.padStart(10)}${'B/glyph'.padStart(9)}  budget`,
  );
  for (const row of rows) {
    const over = row.medianMs / budget120;
    console.log(
      `${row.name.padEnd(13)}${String(row.glyphs).padStart(8)}${`${row.medianMs.toFixed(2)}ms`.padStart(10)}${`${row.p95Ms.toFixed(2)}ms`.padStart(10)}${`${row.minMs.toFixed(2)}ms`.padStart(9)}${`${row.rsdPercent.toFixed(1)}%`.padStart(7)}${row.perGlyphUs.toFixed(3).padStart(10)}${(row.bytesPerUpdate / Math.max(1, row.glyphs)).toFixed(0).padStart(9)}  ${over <= 1 ? 'within 120Hz' : `${over.toFixed(1)}x over 120Hz`}`,
    );
  }
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
