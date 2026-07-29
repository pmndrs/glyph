import { describe, expect, it } from 'vitest';

import { createPayloadSummary, type PayloadFixtureManifests, type PayloadPackageSizeReport } from './payload-summary';

const packageSizes: PayloadPackageSizeReport = {
  entries: [
    ['text-shaper-wasm', 10],
    ['runtime-baker-host-js', 20],
    ['runtime-baker-worker-js', 30],
    ['portable-baker-js', 40],
    ['portable-baker-wasm', 50],
    ['bitmap-runtime-js', 100],
    ['bitmap-baker-js', 200],
    ['bitmap-baker-wasm', 300],
    ['mtsdf-runtime-js', 400],
    ['mtsdf-baker-js', 500],
    ['mtsdf-baker-wasm', 600],
    ['slug-runtime-js', 700],
    ['slug-baker-js', 800],
    ['slug-baker-wasm', 900],
  ].map(([id, gzipBytes]) => ({ id: String(id), status: 'measured', gzipBytes: Number(gzipBytes) })),
};

const fixtureManifests: PayloadFixtureManifests = {
  bitmap: {
    artifacts: [
      { fontFixture: 'inter', bytes: 11, raster: { decodedGpuBytes: 101 } },
      { fontFixture: 'font-awesome-free-6.7.2', bytes: 12, raster: { decodedGpuBytes: 102 } },
    ],
  },
  mtsdf: {
    artifacts: [
      {
        fontFixture: 'inter',
        compressed: { bytes: 21 },
        raster: { runtimeTextureArray: { basePaddedGpuBytes: 201 } },
      },
      {
        fontFixture: 'font-awesome-free-6.7.2',
        compressed: { bytes: 22 },
        raster: { runtimeTextureArray: { basePaddedGpuBytes: 202 } },
      },
    ],
  },
  slug: {
    artifacts: [
      { fontFixture: 'inter', compressed: { bytes: 31 }, raster: { decodedGpuBytes: 301 } },
      {
        fontFixture: 'font-awesome-free-6.7.2',
        compressed: { bytes: 32 },
        raster: { decodedGpuBytes: 302 },
      },
    ],
  },
};

describe('createPayloadSummary', () => {
  it('uses baked Bitmap manifest bytes and the runtime plus shaper gzip total', () => {
    expect(
      createPayloadSummary({
        delivery: 'baked',
        fixtureManifests,
        fontFixture: 'inter',
        packageSizes,
        technique: 'bitmap',
        workload: 'benchmark-ipsum',
      }),
    ).toEqual({
      runtime: { bytes: 110, label: 'Runtime', valueKind: 'gzip' },
      font: { bytes: 11, label: 'Font asset', valueKind: 'bytes' },
      gpu: { bytes: 101, label: 'GPU', valueKind: 'gpu' },
    });
  });

  it('adds the Icon Grid icon and label font MTSDF fixtures', () => {
    const summary = createPayloadSummary({
      delivery: 'baked',
      fixtureManifests,
      fontFixture: 'inter',
      packageSizes,
      technique: 'mtsdf',
      workload: 'icon-grid',
    });

    expect(summary.font).toEqual({ bytes: 43, label: 'Font asset', valueKind: 'gzip' });
    expect(summary.gpu).toEqual({ bytes: 403, label: 'GPU', valueKind: 'gpu' });
  });

  it('uses compatible live Slug values and exposes the lazy runtime bake graph', () => {
    const summary = createPayloadSummary({
      delivery: 'runtime',
      fixtureManifests,
      fontFixture: 'inter',
      liveStats: { technique: 'slug', slugGpuBytes: 4_444, sourceFontBytes: 3_333 },
      packageSizes,
      technique: 'slug',
      workload: 'benchmark-ipsum',
    });

    expect(summary).toEqual({
      runtime: { bytes: 710, label: 'Runtime', valueKind: 'gzip' },
      font: { bytes: 3_333, label: 'Source font', valueKind: 'bytes' },
      gpu: { bytes: 4_444, label: 'GPU', valueKind: 'gpu' },
      lazyBake: { bytes: 1_840, label: 'Bake (lazy)', valueKind: 'gzip' },
    });
  });

  it('does not publish stale live values from another technique', () => {
    const summary = createPayloadSummary({
      delivery: 'runtime',
      fixtureManifests,
      fontFixture: 'inter',
      liveStats: { technique: 'bitmap', atlasGpuBytes: 9_999, sourceFontBytes: 8_888 },
      packageSizes,
      technique: 'mtsdf',
      workload: 'benchmark-ipsum',
    });

    expect(summary.font.bytes).toBeUndefined();
    expect(summary.gpu.bytes).toBe(201);
  });

  it('rejects a fixture manifest that cannot account for every workload font', () => {
    expect(() =>
      createPayloadSummary({
        delivery: 'baked',
        fixtureManifests,
        fontFixture: 'source-serif-4',
        packageSizes,
        technique: 'slug',
        workload: 'icon-grid',
      }),
    ).toThrow('Payload fixture manifest is missing source-serif-4');
  });
});
