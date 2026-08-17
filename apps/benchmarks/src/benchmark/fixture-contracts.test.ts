import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

const contractRoot = new URL('../../fixtures/contracts/', import.meta.url);
const resultRoot = new URL('../../fixtures/results/', import.meta.url);

async function contract(name: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(new URL(name, contractRoot), 'utf8'));
}

async function result(name: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(new URL(name, resultRoot), 'utf8'));
}

describe('milestone-one fixture contracts', () => {
  it('pins bitmap, paragraph, GLB, malformed-input, and GPU-readback source contracts', async () => {
    const [bitmap, paragraph, glb, malformed, gpu] = await Promise.all([
      contract('bitmap-strike-v0.json'),
      contract('paragraph-layout-v0.json'),
      contract('glb-v0.json'),
      contract('malformed-input-v0.json'),
      contract('gpu-readback-v0.json'),
    ]);

    expect(bitmap.strike).toMatchObject({ recordStride: 20, gpuFormat: 'r8unorm' });
    expect(paragraph.constraints.map(({ width }: { width: number }) => width)).toEqual([720, 360]);
    expect(paragraph.status).toBe('golden');
    expect(paragraph.goldens).toMatchObject({
      // Re-derived when the line-terminating word space began to hang (D-257): the
      // single-line `natural` state ends in ink and is unchanged, while both wrapped
      // states lost exactly one 9.0 px space -- Inter's space at this fixture's 32 px --
      // with glyph counts and line counts identical. Measured, not regenerated.
      natural: { layout: { hash: 'bb15bbcc', glyphCount: 55 } },
      wide: { layout: { hash: 'f8b5c3ee', glyphCount: 55 } },
      narrow: { layout: { hash: '5c178199', glyphCount: 55 } },
    });
    expect(glb.container).toMatchObject({ version: 2, alignment: 4, chunkOrder: ['JSON', 'BIN'] });
    expect(new Set(malformed.cases).size).toBe(malformed.cases.length);
    expect(malformed.mustNot).toContain('unbounded-allocation');
    expect(gpu.backends).toEqual(['webgpu', 'webgl2']);
    expect(gpu.status).toBe('capability-gated-until-renderer');
  });

  it('materializes the maximum dense record table with valid logical-page boundaries', async () => {
    const fixture = await contract('max-glyph-pages-v0.json');
    const records = new Uint8Array(fixture.glyphCount * fixture.recordStride);
    const view = new DataView(records.buffer);
    const absent = new Set<number>(fixture.absentGlyphIds);

    for (let glyphId = 0; glyphId < fixture.glyphCount; glyphId += 1) {
      const page = absent.has(glyphId) ? fixture.absenceSentinel : Math.floor(glyphId / fixture.pageCapacity);
      view.setUint16(glyphId * fixture.recordStride + 16, page, true);
    }

    expect(records.byteLength).toBe(fixture.expectedRecordBytes);
    expect(view.getUint16(16, true)).toBe(fixture.absenceSentinel);
    expect(view.getUint16(16383 * 20 + 16, true)).toBe(0);
    expect(view.getUint16(16384 * 20 + 16, true)).toBe(1);
    expect(view.getUint16(32768 * 20 + 16, true)).toBe(2);
    expect(view.getUint16(49152 * 20 + 16, true)).toBe(3);
    expect(view.getUint16(65534 * 20 + 16, true)).toBe(fixture.absenceSentinel);
    expect(fixture.resources.map(({ page }: { page: number }) => page)).toEqual([0, 1, 2, 3]);
  });

  it('defines the identity-neutral empty multi-font/multi-raster state', async () => {
    const fixture = await contract('empty-identities-v0.json');

    expect(fixture.fontHandles).toEqual([]);
    expect(fixture.rasterBindings).toEqual([]);
    expect(fixture.drawBatches).toEqual([]);
    expect(fixture.assertions).toEqual({
      fontCount: 0,
      rasterCount: 0,
      batchCount: 0,
      crossFontGlyphAliasing: false,
    });
  });

  it('keeps the admission record bound to the exact causal probe', async () => {
    const record = JSON.parse(
      await readFile(new URL('../../fixtures/admission/harness-v0.json', import.meta.url), 'utf8'),
    );
    const probe = await readFile(new URL('../../vitexec/admission.probe.ts', import.meta.url));

    expect(createHash('sha256').update(probe).digest('hex')).toBe(record.probe.sha256);
    expect(record.policy).toEqual({
      retries: 0,
      executions: 100,
      freshBrowserServerLifecycles: 10,
      executionsPerLifecycle: 10,
    });
    expect(record.lifecycles).toHaveLength(10);
    expect(
      record.lifecycles.every(
        (lifecycle: { executions: number; uniqueCompletions: number }) =>
          lifecycle.executions === 10 && lifecycle.uniqueCompletions === 10,
      ),
    ).toBe(true);
    expect(record.capabilityClaim.gpuWorkload).toBe(false);
  });

  it('pins the exact TypeScript-to-Rust layout migration comparison', async () => {
    const [baseline, bitmap, mtsdf, slug] = await Promise.all([
      result('typescript-layout-baseline-90964be0-darwin-arm64.json'),
      result('rust-layout-bitmap-0bdb9e93-darwin-arm64.json'),
      result('rust-layout-mtsdf-0bdb9e93-darwin-arm64.json'),
      result('rust-layout-slug-0bdb9e93-darwin-arm64.json'),
    ]);
    const rustRecords = [bitmap, mtsdf, slug];

    expect(baseline).toMatchObject({
      generatedBy: 'glyph:layout-benchmark',
      reports: [
        { name: 'cold', glyphs: 25_515, medianMs: 58.32441699999981 },
        { name: 'font-size', glyphs: 25_515, medianMs: 12.087332999999944 },
        { name: 'layout-width', glyphs: 25_515, medianMs: 9.152791999999863 },
        { name: 'text', glyphs: 25_507, medianMs: 39.607874999999694 },
      ],
    });
    expect(rustRecords.map(({ technique }) => technique)).toEqual(['bitmap', 'mtsdf', 'slug']);
    expect(new Set(rustRecords.map(({ wasmSha256 }) => wasmSha256))).toEqual(
      new Set(['f74f96a6214532271296c8165738d14f71c0642aca4af9050a0363aed2a4d576']),
    );

    const comparableCases = [
      ['cold', 'cold'],
      ['font-size', 'font-size'],
      ['layout-width', 'column-resize'],
      ['text', 'suffix-edit'],
    ] as const;
    for (const record of rustRecords) {
      expect(record).toMatchObject({
        schemaVersion: 0,
        generatedBy: 'glyph:rust-layout-benchmark',
        allocation: 'ordered',
        glyphTarget: 22_000,
        warmup: 8,
        repetitions: 31,
      });
      for (const [baselineName, rustName] of comparableCases) {
        const baselineReport = baseline.reports.find(({ name }: { name: string }) => name === baselineName);
        const rustReport = record.reports.find(({ name }: { name: string }) => name === rustName);
        expect(rustReport.medianMs).toBeLessThan(baselineReport.medianMs);
      }
    }
  });
});
