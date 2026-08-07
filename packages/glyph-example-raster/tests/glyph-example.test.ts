import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FontRegistry,
  rasterBake,
  type GlyphPaint,
  type RasterGlyphInput,
  type RasterKey,
  type RasterResolverContext,
  type RasterResourceResolverContext,
  type RegisteredFont,
  type Sha256Hex,
} from '@pmndrs/text';
import { bakeFont } from '@pmndrs/text/bake';
import { afterEach, describe, expect, test, vi } from 'vitest';

import glyphExampleBaker from '../src/baker.js';
import { GLYPH_EXAMPLE_KIND, glyphExample, glyphExampleDescriptor, type GlyphExampleData } from '../src/index.js';

const source = new URL('../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('public external raster proof', () => {
  test('bakes deterministic standalone companion bytes', async () => {
    const request = {
      font: {
        source: new Uint8Array(),
        fontFaceIndex: 0,
        glyphCount: 5,
        shapingHash: '1'.repeat(64) as Sha256Hex,
      },
      rasterKey: '2'.repeat(64) as RasterKey,
      packaging: { artifact: 'external', pages: 'external' } as const,
      descriptor: glyphExampleDescriptor({ paletteSeed: 7, inset: 0.1 }),
    };
    const [left, right] = await Promise.all([glyphExampleBaker.bake(request), glyphExampleBaker.bake(request)]);

    expect(left).toEqual(right);
    expect(left.kind).toBe(GLYPH_EXAMPLE_KIND);
    expect(left.artifacts.map(({ role }) => role)).toEqual(['raster', 'raster-page']);
    expect(left.artifacts[0]?.bytes.subarray(0, 4)).toEqual(Uint8Array.of(0x67, 0x6c, 0x54, 0x46));
  });

  test('bakes, authenticates, loads, and resolves package-owned external records through public APIs', async () => {
    const baked = await bakeFixture({ artifact: 'external', pages: 'external' });
    const core = baked.execution.outputs.find(({ role }) => role === 'font');
    const companion = baked.execution.outputs.find(({ role }) => role === 'raster');
    const records = baked.execution.outputs.find(({ role }) => role === 'raster-page');
    assert.ok(core && companion && records);
    const registry = new FontRegistry();
    const font = await registry.registerAsset(await readFile(core.file));
    const resolve = vi.fn(async (_context: RasterResolverContext) => readFile(companion.file));
    const resolveResource = vi.fn(async (_context: RasterResourceResolverContext) => readFile(records.file));

    try {
      const raster = await font.loadRaster(rasterSelection(font), { resolve, resolveResource });
      const data = await glyphExample.decode(font, raster);
      expect(raster.kind).toBe(GLYPH_EXAMPLE_KIND);
      expect(data.colors.byteLength).toBe(font.glyphCount * 4);
      expect(data.binding.inset).toBe(glyphExampleDescriptor({ paletteSeed: 7 }).inset);
      expect(resolve).toHaveBeenCalledOnce();
      expect(resolveResource).toHaveBeenCalledOnce();
      expect(resolve.mock.calls[0]?.[0].reference.kind).toBe(GLYPH_EXAMPLE_KIND);
      expect(resolveResource.mock.calls[0]?.[0].source.artifactHash).toMatch(/^[0-9a-f]{64}$/);
      glyphExample.dispose(data);
    } finally {
      font.dispose();
    }
  });

  test('selects one shared resource and packs canonical instances without a renderer', async () => {
    const { font, data } = await loadEmbedded();
    try {
      const selection = glyphExample.select(glyph(data, 1));
      expect(selection).toEqual({ resource: data.resource, pipelineVariant: 0, binding: data.binding });
      expect(glyphExample.select(glyph(data, 2))?.binding).toBe(data.binding);

      const storage = glyphExample.createStorage(4);
      glyphExample.writeStorage(
        storage,
        { start: 1, count: 2 },
        { data, binding: data.binding, glyphs: [glyph(data, 1), glyph(data, 2)] },
      );
      // Canonical storage is Float32Array, so every expectation compares at single precision.
      const inset = data.binding.inset * 16;
      expect(Array.from(storage.origins.subarray(0, 2))).toEqual([0, 0]);
      expectClose(Array.from(storage.origins.subarray(2, 4)), [inset, 12 - 16 * 0.8 + inset]);
      expectClose(Array.from(storage.sizes.subarray(2, 4)), [16 * 0.65 - inset * 2, 16 - inset * 2]);
      expectClose(Array.from(storage.colors.subarray(4, 8)), glyphColor(data, 1));
      expectClose(Array.from(storage.colors.subarray(8, 12)), glyphColor(data, 2));

      expect(() =>
        glyphExample.writeStorage(
          storage,
          { start: 0, count: 1 },
          { data, binding: { ...data.binding }, glyphs: [glyph(data, 1)] },
        ),
      ).toThrow(/binding does not belong/);
      expect(() =>
        glyphExample.writeStorage(
          storage,
          { start: 4, count: 1 },
          { data, binding: data.binding, glyphs: [glyph(data, 1)] },
        ),
      ).toThrow(/outside its capacity/);
      expect(() => glyphExample.select(glyph(data, font.glyphCount))).toThrow(/unavailable glyph/);

      glyphExample.dispose(data);
    } finally {
      font.dispose();
    }
  });

  test('rejects paint the package cannot render', async () => {
    const { font, data } = await loadEmbedded();
    try {
      expect(() =>
        glyphExample.validatePaint?.({
          paintIndices: Uint16Array.of(0),
          palette: [{ color: [1, 1, 1, 1], outline: { color: [0, 0, 0, 1], width: 1 } }],
        }),
      ).toThrow(/fill color and opacity only/);
      expect(() =>
        glyphExample.validatePaint?.({ paintIndices: Uint16Array.of(0), palette: [{ color: [1, 1, 2, 1] }] }),
      ).toThrow(/four finite linear values/);
      glyphExample.dispose(data);
    } finally {
      font.dispose();
    }
  });

  test('honors cancellation before decoding and leaves no decoded data', async () => {
    const baked = await bakeFixture({ artifact: 'embedded', pages: 'embedded' });
    const core = baked.execution.outputs.find(({ role }) => role === 'font');
    assert.ok(core);
    const registry = new FontRegistry();
    const font = await registry.registerAsset(await readFile(core.file));
    const raster = await font.loadRaster(rasterSelection(font));
    const controller = new AbortController();
    controller.abort(new DOMException('cancel glyph-example decode', 'AbortError'));

    await expect(glyphExample.decode(font, raster, controller.signal)).rejects.toThrowError(
      expect.objectContaining({ name: 'AbortError' }),
    );
    font.dispose();
  });
});

async function loadEmbedded(): Promise<{ readonly font: RegisteredFont; readonly data: GlyphExampleData }> {
  const baked = await bakeFixture({ artifact: 'embedded', pages: 'embedded' });
  const core = baked.execution.outputs.find(({ role }) => role === 'font');
  assert.ok(core);
  const font = await new FontRegistry().registerAsset(await readFile(core.file));
  const raster = await font.loadRaster(rasterSelection(font));
  return { font, data: await glyphExample.decode(font, raster) };
}

/** The baked artifact advertises its own raster key, so the test never reimplements key derivation. */
function rasterSelection(font: RegisteredFont): { readonly rasterKey: RasterKey; readonly kind: 'glyphExample' } {
  const reference = font.rasterReferences.find(({ kind }) => kind === GLYPH_EXAMPLE_KIND);
  assert.ok(reference, 'baked font must advertise its glyph-example raster');
  return { rasterKey: reference.rasterKey, kind: GLYPH_EXAMPLE_KIND };
}

async function bakeFixture(packaging: {
  readonly artifact: 'embedded' | 'external';
  readonly pages: 'embedded' | 'external';
}) {
  const directory = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-example-'));
  temporaryDirectories.push(directory);
  return bakeFont({
    input: source,
    output: join(directory, 'inter.font.glb'),
    font: { fontFaceIndex: 0 },
    rasters: [rasterBake(glyphExampleBaker, { packaging, options: { paletteSeed: 7 } })],
  });
}

function glyph(data: GlyphExampleData, glyphId: number): RasterGlyphInput<GlyphExampleData> {
  return { data, glyphId, fontSize: 16, originX: 0, originY: 12, rasterPixelRatio: 1, paint: paint().palette[0]! };
}

function expectClose(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  for (const [index, value] of expected.entries()) expect(actual[index]).toBeCloseTo(value, 6);
}

function glyphColor(data: GlyphExampleData, glyphId: number): readonly number[] {
  return Array.from(data.colors.subarray(glyphId * 4, glyphId * 4 + 4), (value) => value / 255);
}

function paint(): GlyphPaint {
  return { palette: [{ color: [1, 1, 1, 1] }], paintIndices: Uint16Array.of(0) };
}
