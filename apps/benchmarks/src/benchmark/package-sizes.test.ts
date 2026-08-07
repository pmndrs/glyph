import { describe, expect, it } from 'vitest';
import report from '../generated/package-sizes.json';
import { packageSizeBudgets } from './package-size-budgets';
import { assertPackageSizeReportFresh } from './package-size-report';

describe('independent package-size report', () => {
  it('identifies every measured payload by SHA-256', () => {
    expect(report.schemaVersion).toBe(1);
    for (const entry of report.entries) {
      if (entry.status !== 'measured') continue;
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('rejects a same-size payload identity change', () => {
    const changed = structuredClone(report);
    const browserCore = changed.entries.find(({ id }) => id === 'browser-core');
    if (browserCore?.status !== 'measured') throw new Error('Missing browser-core measurement');
    browserCore.sha256 = '0'.repeat(64);
    expect(() => assertPackageSizeReportFresh(report, changed)).toThrow(/stale/);
  });

  it('contains nonzero public core, baker JavaScript, and baker Wasm measurements', () => {
    for (const id of [
      'browser-core',
      'font-validator-js',
      'runtime-baker-host-js',
      'runtime-baker-worker-js',
      'text-shaper-js',
      'text-shaper-wasm',
      'bitmap-runtime-js',
      'mtsdf-runtime-js',
      'slug-runtime-js',
      'bitmap-baker-js',
      'bitmap-baker-wasm',
      'mtsdf-generator-js',
      'mtsdf-generator-wasm',
      'mtsdf-baker-js',
      'mtsdf-baker-wasm',
      'slug-baker-js',
      'slug-baker-wasm',
      'portable-baker-js',
      'portable-baker-wasm',
      'unicode-analysis-js',
    ]) {
      const entry = report.entries.find((candidate) => candidate.id === id);
      expect(entry?.status).toBe('measured');
      if (entry?.status !== 'measured') throw new Error(`Missing measured size entry: ${id}`);
      expect(entry.rawBytes).toBeGreaterThan(0);
      expect(entry.minifiedBytes).toBeGreaterThan(0);
      expect(entry.gzipBytes).toBeGreaterThan(0);
      expect(entry.brotliBytes).toBeGreaterThan(0);
    }
  });

  it('enforces every reviewed runtime and Wasm ceiling', () => {
    for (const [id, budget] of Object.entries(packageSizeBudgets)) {
      const entry = report.entries.find((candidate) => candidate.id === id);
      expect(entry?.status).toBe('measured');
      if (entry?.status !== 'measured') throw new Error(`Missing measured size entry: ${id}`);
      expect(entry.rawBytes).toBeLessThanOrEqual(budget.rawBytes);
      expect(entry.minifiedBytes).toBeLessThanOrEqual(budget.minifiedBytes);
      expect(entry.gzipBytes).toBeLessThanOrEqual(budget.gzipBytes);
      expect(entry.brotliBytes).toBeLessThanOrEqual(budget.brotliBytes);
    }
  });

  it('bounds accumulated target-v1 growth from the pre-coverage baseline', () => {
    const coverageGrowth = {
      // These ceilings exist to keep feature work honest and to push back on duplication, not to model a delivery
      // constraint. Target-v1 spent the allowance on two consolidations rather than on new surface: one span cascade
      // replaced a style sweep plus seven per-property heaps and now serves both the shaping and paint layers, and the
      // Three Bitmap program regained the device-pixel snapping milestone 1 records as a hard contract.
      //
      // The three runtime baselines are re-derived against the tree with merged-v0 deleted, which shed roughly 215 KB
      // from each graph, so growth is once again measured from something that exists. browser-core keeps its original
      // pre-coverage baseline because deleting v0 did not move it: the root index never referenced v0, v0 re-exported
      // the root. Each ceiling leaves roughly one or two features of room and no more, so it starts pushing back soon
      // rather than quietly absorbing whatever lands next.
      'browser-core': {
        rawBytes: { baseline: 324_269, maximumGrowth: 54_000 },
        minifiedBytes: { baseline: 247_205, maximumGrowth: 34_000 },
        gzipBytes: { baseline: 72_108, maximumGrowth: 9_200 },
        brotliBytes: { baseline: 55_251, maximumGrowth: 7_400 },
      },
      'bitmap-baker-js': {
        rawBytes: { baseline: 17_478, maximumGrowth: 5_700 },
        minifiedBytes: { baseline: 11_682, maximumGrowth: 4_000 },
        gzipBytes: { baseline: 3_893, maximumGrowth: 900 },
        brotliBytes: { baseline: 3_448, maximumGrowth: 800 },
      },
      'bitmap-baker-wasm': {
        rawBytes: { baseline: 606_995, maximumGrowth: 20_000 },
        minifiedBytes: { baseline: 606_995, maximumGrowth: 20_000 },
        gzipBytes: { baseline: 226_702, maximumGrowth: 8_100 },
        brotliBytes: { baseline: 173_552, maximumGrowth: 7_000 },
      },
      'bitmap-runtime-js': {
        rawBytes: { baseline: 178_792, maximumGrowth: 12_000 },
        minifiedBytes: { baseline: 115_766, maximumGrowth: 7_000 },
        gzipBytes: { baseline: 28_450, maximumGrowth: 1_800 },
        brotliBytes: { baseline: 24_500, maximumGrowth: 1_500 },
      },
      'mtsdf-baker-wasm': {
        rawBytes: { baseline: 534_709, maximumGrowth: 18_500 },
        minifiedBytes: { baseline: 534_709, maximumGrowth: 18_500 },
        gzipBytes: { baseline: 208_474, maximumGrowth: 6_700 },
        brotliBytes: { baseline: 163_570, maximumGrowth: 5_800 },
      },
      'mtsdf-baker-js': {
        rawBytes: { baseline: 21_809, maximumGrowth: 5_200 },
        minifiedBytes: { baseline: 15_430, maximumGrowth: 3_800 },
        gzipBytes: { baseline: 4_701, maximumGrowth: 900 },
        brotliBytes: { baseline: 4_176, maximumGrowth: 800 },
      },
      'mtsdf-runtime-js': {
        rawBytes: { baseline: 178_789, maximumGrowth: 12_000 },
        minifiedBytes: { baseline: 115_832, maximumGrowth: 7_000 },
        gzipBytes: { baseline: 28_449, maximumGrowth: 1_800 },
        brotliBytes: { baseline: 24_558, maximumGrowth: 1_500 },
      },
    } as const;
    const fields = ['rawBytes', 'minifiedBytes', 'gzipBytes', 'brotliBytes'] as const;
    for (const [id, expectation] of Object.entries(coverageGrowth)) {
      const entry = report.entries.find((candidate) => candidate.id === id);
      expect(entry?.status).toBe('measured');
      if (entry?.status !== 'measured') throw new Error(`Missing measured size entry: ${id}`);
      for (const field of fields) {
        const { baseline, maximumGrowth } = expectation[field];
        expect(entry[field] - baseline).toBeLessThanOrEqual(maximumGrowth);
      }
    }
  });

  it('bounds retained-capacity growth from the warm-publication baseline', () => {
    const retainedCapacityGrowth = {
      'bitmap-runtime-js': {
        baseline: { rawBytes: 178_792, minifiedBytes: 115_766, gzipBytes: 28_450, brotliBytes: 24_500 },
        // These ceilings were reviewed against a target-v1 that was missing two things it now carries. The Three
        // Bitmap program had no device-pixel snapping, which milestone 1 records as a hard density contract and
        // which is what makes this graph reproduce the pinned merged-v0 frame exactly. Spans resolved shaping and
        // paint through two unrelated mechanisms that disagreed, replaced by one containment cascade — a net cost,
        // since it deleted the previous style sweep and its per-property heaps.
        //
        // Baselines re-derived after merged-v0 deletion. Brotli stays the tightest of the four because it is what
        // ships to browsers. NOTE these three graphs are currently within three bytes of each other because /three
        // registers every built-in program at module scope; once technique-paired subpaths restore separation per
        // D-158 they will diverge again and these baselines need re-deriving once more.
        maximumGrowth: { rawBytes: 12_000, minifiedBytes: 7_000, gzipBytes: 1_800, brotliBytes: 1_500 },
      },
      'mtsdf-runtime-js': {
        baseline: { rawBytes: 178_789, minifiedBytes: 115_832, gzipBytes: 28_449, brotliBytes: 24_558 },
        maximumGrowth: { rawBytes: 12_000, minifiedBytes: 7_000, gzipBytes: 1_800, brotliBytes: 1_500 },
      },
      'slug-runtime-js': {
        baseline: { rawBytes: 178_790, minifiedBytes: 115_762, gzipBytes: 28_385, brotliBytes: 24_521 },
        maximumGrowth: { rawBytes: 12_000, minifiedBytes: 7_000, gzipBytes: 1_800, brotliBytes: 1_500 },
      },
    } as const;
    const fields = ['rawBytes', 'minifiedBytes', 'gzipBytes', 'brotliBytes'] as const;
    for (const [id, expectation] of Object.entries(retainedCapacityGrowth)) {
      const entry = report.entries.find((candidate) => candidate.id === id);
      expect(entry?.status).toBe('measured');
      if (entry?.status !== 'measured') throw new Error(`Missing measured size entry: ${id}`);
      for (const field of fields) {
        expect(entry[field] - expectation.baseline[field]).toBeLessThanOrEqual(expectation.maximumGrowth[field]);
      }
    }
  });

  it('keeps the lazy validator out of the initial browser-core measurement', () => {
    const core = report.entries.find((candidate) => candidate.id === 'browser-core');
    const validator = report.entries.find((candidate) => candidate.id === 'font-validator-js');
    expect(core?.status).toBe('measured');
    expect(validator?.status).toBe('measured');
    if (core?.status !== 'measured' || validator?.status !== 'measured') return;
    if (core.minifiedBytes === undefined || validator.minifiedBytes === undefined) {
      throw new Error('Measured entries must contain minified byte counts');
    }
    expect(core.minifiedBytes).toBeLessThan(validator.minifiedBytes);
  });

  it('reports Unicode analysis independently from the initial browser graph', () => {
    const core = report.entries.find((candidate) => candidate.id === 'browser-core');
    const unicode = report.entries.find((candidate) => candidate.id === 'unicode-analysis-js');
    expect(core?.status).toBe('measured');
    expect(unicode?.status).toBe('measured');
    if (core?.status !== 'measured' || unicode?.status !== 'measured') return;
    expect(unicode.minifiedBytes).toBeGreaterThan(0);
    expect(core.minifiedBytes).toBeGreaterThan(unicode.minifiedBytes);
  });

  it('keeps foreign-host native-tool variance inside complete reviewed budgets', () => {
    const foreign = structuredClone(report);
    foreign.measurementHost = { platform: 'linux', architecture: 'x64' };
    const linuxX64Measurements = {
      'browser-core': [271_169, 211_199, 62_771, 48_040],
      'font-validator-js': [740_402, 584_255, 137_585, 112_927],
      'runtime-baker-host-js': [5_264, 3_861, 1_480, 1_322],
      'runtime-baker-worker-js': [13_315, 9_010, 3_030, 2_665],
      'text-shaper-js': [43_944, 30_648, 8_798, 7_832],
      'text-shaper-wasm': [692_111, 692_111, 258_524, 202_634],
      'portable-baker-js': [10_046, 6_647, 2_338, 2_060],
      'portable-baker-wasm': [433_755, 433_755, 168_266, 136_961],
      'unicode-analysis-js': [164_786, 139_936, 42_047, 30_989],
    } as const;
    for (const [id, [rawBytes, minifiedBytes, gzipBytes, brotliBytes]] of Object.entries(linuxX64Measurements)) {
      const entry = foreign.entries.find((candidate) => candidate.id === id);
      if (entry?.status !== 'measured') throw new Error(`Missing foreign-host measurement: ${id}`);
      Object.assign(entry, { rawBytes, minifiedBytes, gzipBytes, brotliBytes });
    }
    expect(() => assertPackageSizeReportFresh(report, foreign)).not.toThrow();

    const changedSameHost = structuredClone(report);
    const browserCore = changedSameHost.entries.find(({ id }) => id === 'browser-core');
    if (browserCore?.status !== 'measured') throw new Error('Missing browser-core measurement');
    browserCore.minifiedBytes += 1;
    expect(() => assertPackageSizeReportFresh(report, changedSameHost)).toThrow(/stale/);

    const oversizedForeign = structuredClone(foreign);
    const shaper = oversizedForeign.entries.find(({ id }) => id === 'text-shaper-wasm');
    if (shaper?.status !== 'measured') throw new Error('Missing text-shaper-wasm measurement');
    shaper.minifiedBytes = packageSizeBudgets['text-shaper-wasm'].minifiedBytes + 1;
    expect(() => assertPackageSizeReportFresh(report, oversizedForeign)).toThrow(/exceeds/);
  });
});
