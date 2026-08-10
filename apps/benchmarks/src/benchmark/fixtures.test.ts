import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

interface Glyph {
  glyphId: number;
  cluster: number;
  xAdvance: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
  flags: number;
}

interface Oracle {
  engine: { name: string; version: string };
  cases: { id: string; glyphs: Glyph[] }[];
}

interface FixtureMapping {
  readonly codePoints: readonly string[];
  readonly mapping: { readonly kind: string; readonly glyphId: number };
}

const fixtureRoot = new URL('../../fixtures/', import.meta.url);
const executeFile = promisify(execFile);

describe('canonical Inter fixtures', () => {
  it('binds checked-in font and license bytes to their manifest hashes', async () => {
    const directory = new URL('fonts/inter-v4.1/', fixtureRoot);
    const [manifestSource, font, license] = await Promise.all([
      readFile(new URL('manifest.json', directory), 'utf8'),
      readFile(new URL('Inter-Regular.ttf', directory)),
      readFile(new URL('LICENSE.txt', directory)),
    ]);
    const manifest = JSON.parse(manifestSource);

    expect(font.byteLength).toBe(manifest.source.fontBytes);
    expect(createHash('sha256').update(font).digest('hex')).toBe(manifest.source.fontSha256);
    expect(createHash('sha256').update(license).digest('hex')).toBe(manifest.source.licenseSha256);
  });

  it('keeps HarfRust and HarfBuzz core shaping equal and makes accepted flag deltas explicit', async () => {
    const directory = new URL('shaping/inter-regular/', fixtureRoot);
    const [harfrust, harfbuzz] = (await Promise.all(
      ['harfrust.json', 'harfbuzz.json'].map(async (name) =>
        JSON.parse(await readFile(new URL(name, directory), 'utf8')),
      ),
    )) as [Oracle, Oracle];

    expect(harfrust.engine).toMatchObject({ name: 'HarfRust', version: '0.12.0' });
    expect(harfbuzz.engine).toMatchObject({ name: 'HarfBuzz', version: '13.0.0' });
    expect(harfrust.cases.map(({ id }) => id)).toEqual(harfbuzz.cases.map(({ id }) => id));

    const flagDeltas: string[] = [];
    for (const [caseIndex, rustCase] of harfrust.cases.entries()) {
      const buzzCase = harfbuzz.cases[caseIndex];
      expect(buzzCase?.glyphs).toHaveLength(rustCase.glyphs.length);
      for (const [glyphIndex, rustGlyph] of rustCase.glyphs.entries()) {
        const buzzGlyph = buzzCase?.glyphs[glyphIndex];
        expect(buzzGlyph).toBeDefined();
        const { flags: rustFlags, ...rustCore } = rustGlyph;
        const { flags: buzzFlags, ...buzzCore } = buzzGlyph as Glyph;
        expect(rustCore).toEqual(buzzCore);
        if (rustFlags !== buzzFlags) {
          flagDeltas.push(`${rustCase.id}:${glyphIndex}:${rustFlags}->${buzzFlags}`);
        }
      }
    }

    expect(flagDeltas).toEqual(['paragraph:14:0->2', 'paragraph:26:0->2', 'combining-mark:0:0->2']);
  });

  it('binds the HTML/CSS reference metadata to the captured PNG', async () => {
    const directory = new URL('visual/inter-regular/', fixtureRoot);
    const [metadataSource, image] = await Promise.all([
      readFile(new URL('browser-html.json', directory), 'utf8'),
      readFile(new URL('browser-html.png', directory)),
    ]);
    const metadata = JSON.parse(metadataSource);

    expect(metadata.browser).toEqual({
      engine: 'chromium',
      version: '149.0.7827.55',
      playwright: '1.61.1',
      headless: true,
    });
    expect(image.byteLength).toBe(metadata.image.bytes);
    expect(createHash('sha256').update(image).digest('hex')).toBe(metadata.image.sha256);
  });
});

describe('advanced-shaping result', () => {
  it('records every authored public Text frame with exact layout and batch identity', async () => {
    const result = JSON.parse(
      await readFile(new URL('results/advanced-shaping-conformance-chromium149.json', fixtureRoot), 'utf8'),
    );
    expect(result).toMatchObject({
      schemaVersion: 0,
      targetId: 'advanced-shaping-conformance',
      scenarioId: 'advanced-shaping-conformance',
      status: 'passed',
      controls: { dpr: 1, samples: 3, warmup: 1 },
      outputBytes: 17_362,
    });
    expect(result.measurements).toHaveLength(3);
    expect(
      result.measurements.every(
        ({ hash, metrics }: { hash: string; metrics: Record<string, number> }) =>
          hash === '51ba1d14' &&
          metrics.caseCount === 5 &&
          metrics.frameCount === 68 &&
          metrics.layoutBytes === 17_362 &&
          metrics.glyphCount === 709 &&
          metrics.missingGlyphCount === 0 &&
          metrics.renderedGlyphCount === 625 &&
          metrics.drawCount === 72,
      ),
    ).toBe(true);
  });
});

describe('advanced-shaping performance observation', () => {
  it('labels the environment and retains consumer costs for every showcase lane', async () => {
    const result = JSON.parse(
      await readFile(new URL('results/advanced-shaping-performance-chromium149.json', fixtureRoot), 'utf8'),
    );
    expect(result).toMatchObject({
      schemaVersion: 0,
      kind: 'live-performance-observation',
      backend: 'webgpu',
      dpr: 1,
      steadyStateReportCount: 12,
      environment: { hardwareConcurrency: 10, webgpu: true },
      gpuAdapter: { architecture: 'metal-3', vendor: 'apple' },
    });
    expect(result.cases.map(({ id }: { id: string }) => id)).toEqual([
      'latin-features',
      'arabic-joining',
      'indic-reordering',
      'mixed-bidi',
      'cjk-line-breaks',
    ]);
    expect(
      result.cases.every((entry: Record<string, unknown>) =>
        Object.entries(entry).every(
          ([name, value]) =>
            name === 'id' ||
            name === 'fontFixture' ||
            (typeof value === 'number' && Number.isFinite(value) && value >= 0),
        ),
      ),
    ).toBe(true);
  });
});

describe('canonical Amiri fixtures', () => {
  it('binds font, metadata, and license bytes to the immutable import', async () => {
    const directory = new URL('fonts/amiri-1.002/', fixtureRoot);
    const [manifestSource, font, metadata, license] = await Promise.all([
      readFile(new URL('manifest.json', directory), 'utf8'),
      readFile(new URL('Amiri-Regular.ttf', directory)),
      readFile(new URL('METADATA.pb', directory)),
      readFile(new URL('OFL.txt', directory)),
    ]);
    const manifest = JSON.parse(manifestSource);

    expect(font.byteLength).toBe(manifest.source.fontBytes);
    expect(createHash('sha256').update(font).digest('hex')).toBe(manifest.source.fontSha256);
    expect(createHash('sha256').update(metadata).digest('hex')).toBe(manifest.source.metadataSha256);
    expect(createHash('sha256').update(license).digest('hex')).toBe(manifest.source.licenseSha256);
  });

  it('matches pinned HarfBuzz 13 exactly for Arabic, joining, marks, numbers, and Latin', async () => {
    const directory = new URL('shaping/amiri-regular/', fixtureRoot);
    const [harfrust, harfbuzz] = (await Promise.all(
      ['harfrust.json', 'harfbuzz.json'].map(async (name) =>
        JSON.parse(await readFile(new URL(name, directory), 'utf8')),
      ),
    )) as [Oracle, Oracle];

    expect(harfrust.engine).toMatchObject({ name: 'HarfRust', version: '0.12.0' });
    expect(harfbuzz.engine).toMatchObject({ name: 'HarfBuzz', version: '13.0.0' });
    expect(harfrust.cases.map(({ id }) => id)).toEqual(['arabic-joining', 'lam-alef', 'arabic-numbers', 'latin']);
    expect(harfrust.cases).toEqual(harfbuzz.cases);
  });
});

describe('canonical Noto Sans CJK fixtures', () => {
  it('binds the maximum-glyph font and license to its manifest and replayed inspector facts', async () => {
    const directory = new URL('fonts/noto-sans-cjk-2.004/', fixtureRoot);
    const [manifestSource, font, license] = await Promise.all([
      readFile(new URL('manifest.json', directory), 'utf8'),
      readFile(new URL('NotoSansCJKjp-Regular.otf', directory)),
      readFile(new URL('LICENSE.txt', directory)),
    ]);
    const manifest = JSON.parse(manifestSource);

    expect(manifest).toMatchObject({
      schemaVersion: 0,
      id: 'noto-sans-cjk-jp-regular-v0',
      source: {
        family: 'Noto Sans CJK JP',
        style: 'Regular',
        version: '2.004',
        releaseTag: 'Sans2.004',
        fontFile: 'NotoSansCJKjp-Regular.otf',
        license: 'OFL-1.1',
        licenseFile: 'LICENSE.txt',
      },
      face: { fontIndex: 0, variations: {}, glyphCount: 0xffff, glyphIdWidth: 16 },
      versions: { harfrust: '0.12.0', harfbuzz: '13.0.0', unicode: '17.0.0' },
    });
    expect(font.byteLength).toBe(manifest.source.fontBytes);
    expect(createHash('sha256').update(font).digest('hex')).toBe(manifest.source.fontSha256);
    expect(createHash('sha256').update(license).digest('hex')).toBe(manifest.source.licenseSha256);

    const inspectorArguments = [
      'run',
      '--manifest-path',
      fileURLToPath(new URL('../../../../packages/text/rust/font-baker/Cargo.toml', import.meta.url)),
      '--bin',
      'inspect-font-fixture',
      '--features',
      'oracle',
      '--locked',
      '--quiet',
      '--',
      fileURLToPath(new URL('NotoSansCJKjp-Regular.otf', directory)),
      '--face-index',
      String(manifest.face.fontIndex),
    ];
    for (const mapping of manifest.inspection.mappings) {
      inspectorArguments.push('--map', mapping.codePoints.join('+'));
    }
    const { stdout } = await executeFile('cargo', inspectorArguments);
    const { mappings, ...inspection } = JSON.parse(stdout);
    expect(inspection).toEqual({
      schemaVersion: 0,
      faceIndex: manifest.face.fontIndex,
      glyphCount: manifest.face.glyphCount,
      tables: manifest.inspection.tables,
      cmapFormats: manifest.inspection.cmapFormats,
    });
    const mappingsByCodePoint = (values: readonly FixtureMapping[]) =>
      new Map(values.map((mapping) => [mapping.codePoints.join('+'), mapping.mapping]));
    expect(mappingsByCodePoint(mappings)).toEqual(mappingsByCodePoint(manifest.inspection.mappings));
  });

  it('matches pinned HarfBuzz exactly in every CJK glyph field', async () => {
    const directory = new URL('shaping/noto-sans-cjk/', fixtureRoot);
    const [corpus, harfrust, harfbuzz] = await Promise.all(
      ['cases.json', 'harfrust.json', 'harfbuzz.json'].map(async (name) =>
        JSON.parse(await readFile(new URL(name, directory), 'utf8')),
      ),
    );

    expect(harfrust.engine).toEqual({
      name: 'HarfRust',
      version: '0.12.0',
      commit: '60b28ea22b5261710018d69c168a762bcb28794c',
    });
    expect(harfbuzz.engine).toEqual({
      name: 'HarfBuzz',
      version: '13.0.0',
      commit: 'a0fc099681a69ae40665fbea74982a2e9d7a5260',
      sourceArchiveSha256: '1626ebc763d28f4bcca1531fef42e92ca995d45f8ad90ad2ae0b5d1a567fe67a',
    });
    expect(harfrust).toMatchObject({
      schemaVersion: 0,
      fontFixture: 'noto-sans-cjk-jp-regular-v0',
      clusterUnit: 'utf16',
      positionUnit: 'font-unit',
    });
    expect(harfbuzz).toMatchObject({
      schemaVersion: 0,
      fontFixture: 'noto-sans-cjk-jp-regular-v0',
      clusterUnit: 'utf16',
      positionUnit: 'font-unit',
    });
    expect(harfrust.cases.map(({ id }: { id: string }) => id)).toEqual(
      corpus.cases.map(({ id }: { id: string }) => id),
    );
    expect(harfrust.cases).toEqual(harfbuzz.cases);
  });
});
