/* @workflow { "name": "glyph:native-grapheme-spike", "summary": "Compare native Intl.Segmenter with the pinned Unicode segmenter for conformance, throughput, and shipped bytes.", "requirements": "Built @pmndrs/glyph package and repository-pinned Node.js with Unicode 17 ICU data.", "writes": "Nothing; reports JSON to stdout." } */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { brotliCompressSync, constants, gunzipSync, gzipSync } from 'node:zlib';

import { build } from 'vite';

import { findGraphemeBoundaries } from '../dist/internal/graphemes.js';
import { findNativeGraphemeBoundaries } from '../dist/internal/native-graphemes.js';

interface ConformanceCase {
  readonly line: number;
  readonly text: string;
  readonly boundaries: readonly number[];
}

interface BundleSize {
  readonly rawBytes: number;
  readonly gzipBytes: number;
  readonly brotliBytes: number;
}

const fixture = new URL('../tests/fixtures/unicode-17.0.0/GraphemeBreakTest.txt.gz', import.meta.url);
const cases = await conformanceCases();
const corpusCodeUnits = cases.reduce((total, entry) => total + entry.text.length, 0);

for (const entry of cases) {
  assert.deepEqual(
    [...findGraphemeBoundaries(entry.text)],
    entry.boundaries,
    `pinned GraphemeBreakTest line ${entry.line}`,
  );
  assert.deepEqual(
    [...findNativeGraphemeBoundaries(entry.text)],
    entry.boundaries,
    `native GraphemeBreakTest line ${entry.line}`,
  );
}

const warmup = 100;
const samples = 1_000;
const native = benchmark(
  () => cases.reduce((count, entry) => count + findNativeGraphemeBoundaries(entry.text).length, 0),
  warmup,
  samples,
);
const pinned = benchmark(
  () => cases.reduce((count, entry) => count + findGraphemeBoundaries(entry.text).length, 0),
  warmup,
  samples,
);
const [nativeBundle, pinnedBundle] = await Promise.all([
  bundleSize(new URL('./size-entries/native-graphemes.ts', import.meta.url)),
  bundleSize(new URL('./size-entries/pinned-graphemes.ts', import.meta.url)),
]);

process.stdout.write(
  `${JSON.stringify(
    {
      runtime: { node: process.versions.node, unicode: process.versions.unicode, icu: process.versions.icu },
      conformance: {
        unicode: '17.0.0',
        cases: cases.length,
        nativePassed: cases.length,
        pinnedPassed: cases.length,
      },
      corpus: { vectorsPerSample: cases.length, utf16CodeUnitsPerSample: corpusCodeUnits, samples, warmup },
      throughput: { native, pinned },
      bundle: { native: nativeBundle, pinned: pinnedBundle },
      gzipSavings: pinnedBundle.gzipBytes - nativeBundle.gzipBytes,
    },
    null,
    2,
  )}\n`,
);

function benchmark(operation: () => number, warmupCount: number, sampleCount: number) {
  for (let index = 0; index < warmupCount; index += 1) operation();
  const started = performance.now();
  let boundaries = 0;
  for (let index = 0; index < sampleCount; index += 1) boundaries += operation();
  const durationMs = performance.now() - started;
  return { durationMs, operationsPerSecond: (sampleCount * 1_000) / durationMs, boundaries };
}

async function bundleSize(entry: URL): Promise<BundleSize> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: 'oxc',
      target: 'es2025',
      lib: { entry: entry.pathname, formats: ['es'] },
    },
  });
  const code: string[] = [];
  for (const buildOutput of Array.isArray(result) ? result : [result]) {
    for (const output of buildOutput.output) {
      if (output.type === 'chunk') code.push(output.code);
    }
  }
  const bytes = new TextEncoder().encode(code.join('\n'));
  return {
    rawBytes: bytes.byteLength,
    gzipBytes: gzipSync(bytes, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
  };
}

async function conformanceCases(): Promise<readonly ConformanceCase[]> {
  const compressed = await readFile(fixture);
  const contents = gunzipSync(compressed).toString('utf8');
  const result: ConformanceCase[] = [];
  for (const [index, source] of contents.split(/\r?\n/u).entries()) {
    const body = source.split('#', 1)[0]?.trim();
    if (!body) continue;
    const tokens = body.split(/\s+/u);
    const codePoints: number[] = [];
    const boundaries: number[] = [];
    let utf16Offset = 0;
    for (let cursor = 0; cursor < tokens.length; cursor += 2) {
      if (tokens[cursor] === '÷') boundaries.push(utf16Offset);
      const hexadecimal = tokens[cursor + 1];
      if (hexadecimal === undefined) break;
      const codePoint = Number.parseInt(hexadecimal, 16);
      codePoints.push(codePoint);
      utf16Offset += codePoint > 0xffff ? 2 : 1;
    }
    result.push({ line: index + 1, text: String.fromCodePoint(...codePoints), boundaries });
  }
  return result;
}
