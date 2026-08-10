import { describe, expect, it } from 'vitest';
import report from '../generated/package-sizes.json';
import { packageSizeBudgets } from './package-size-budgets';
import { assertPackageSizeReportFresh } from './package-size-report';
import { sizeLimitRows, summarizePackageSizes } from './package-size-summary';

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
      'text-shaper-wasm',
      'three-runtime-js',
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

  it('projects the useful gzip measurements for people and pull requests', () => {
    const summary = summarizePackageSizes(report);
    expect(summary.map(({ label }) => label)).toEqual([
      'Core JS',
      'Shaper Wasm',
      'Three.js adapter JS',
      'Inter font · Bitmap',
      'Inter font · MTSDF',
      'Inter font · Slug',
      'Font Awesome icons · Bitmap',
      'Font Awesome icons · MTSDF',
      'Font Awesome icons · Slug',
      'Font validator JS',
      'Runtime bake host JS',
      'Runtime bake Worker JS',
      'Font baker JS',
      'Font baker Wasm',
      'Bitmap baker JS',
      'Bitmap baker Wasm',
      'MTSDF baker JS',
      'MTSDF baker Wasm',
      'Slug baker JS',
      'Slug baker Wasm',
    ]);
    expect(sizeLimitRows(report)).toEqual(
      summary.map(({ label, gzipBytes }) => ({ name: `${label} (gzip)`, size: gzipBytes })),
    );
  });

  it('rejects incomplete package-size summaries instead of publishing misleading rows', () => {
    const incomplete = structuredClone(report);
    incomplete.entries = incomplete.entries.filter(({ id }) => id !== 'text-shaper-wasm');
    expect(() => summarizePackageSizes(incomplete)).toThrow(/text-shaper-wasm/);
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
    expect(core.minifiedBytes).toBeLessThan(unicode.minifiedBytes);
  });

  it('keeps foreign-host native-tool variance inside complete reviewed budgets', () => {
    const foreign = structuredClone(report);
    foreign.measurementHost = { platform: 'linux', architecture: 'x64' };
    const linuxX64Measurements = {
      'browser-core': [271_169, 211_199, 62_771, 48_040],
      'font-validator-js': [740_402, 584_255, 137_585, 112_927],
      'runtime-baker-host-js': [5_264, 3_861, 1_480, 1_322],
      'runtime-baker-worker-js': [13_315, 9_010, 3_030, 2_665],
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
