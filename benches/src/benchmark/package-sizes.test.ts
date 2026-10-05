import { describe, expect, it } from 'vitest';
import report from '../generated/package-sizes.json' with { type: 'json' };
import { formatCompactSizeLimitMarkdown, sizeLimitRows, summarizePackageSizes } from './package-size-summary';

describe('independent package-size report', () => {
  it('identifies every measured payload by SHA-256', () => {
    expect(report.schemaVersion).toBe(1);
    for (const entry of report.entries) {
      if (entry.status !== 'measured') continue;
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('contains nonzero public core, baker JavaScript, and baker Wasm measurements', () => {
    for (const id of [
      'browser-core',
      'font-validator-js',
      'runtime-baker-host-js',
      'runtime-baker-worker-js',
      'text-shaper-wasm',
      'three-runtime-js',
      'react-runtime-js',
      'vue-runtime-js',
      'r3f-hello-world-production-js',
      'tres-playground-production-js',
      'three-typegpu-runtime-js',
      'typegpu-direct-renderer-js',
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

  it('projects the useful gzip measurements for people and pull requests', () => {
    const summary = summarizePackageSizes(report);
    expect(summary.map(({ label }) => label)).toEqual([
      'Core JS',
      'Shaper Wasm',
      'Three.js adapter JS',
      'React adapter JS',
      'Vue adapter JS',
      'R3F hello-world app JS',
      'Tres playground app JS',
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

  it('presents every measured surface once in balanced compact columns', () => {
    const current = sizeLimitRows(report);
    const base = current.map((row) => ({ ...row, size: row.size - 1 }));
    const markdown = formatCompactSizeLimitMarkdown(base, current);
    expect(markdown.split('\n')[0]).toBe('| Surface | gzip | Surface | gzip |');
    expect(markdown.split('\n')).toHaveLength(14);
    for (const { label } of summarizePackageSizes(report)) {
      expect(markdown.split(label)).toHaveLength(2);
    }
  });
});
