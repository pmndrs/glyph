import { liveWorkloadFontFixtures, type BenchmarkFontFixture } from './font-fixtures';
import type { FontDelivery, RasterTechnique } from './url-state';
import { benchmarkWorkloadDefinition, isBenchmarkWorkloadId } from '../workloads/catalog';
import { workloadCompanionFontFixtures } from '../workloads/shared/definition';

export interface PayloadPackageSizeEntry {
  readonly id: string;
  readonly status: string;
  readonly gzipBytes?: number;
}

export interface PayloadPackageSizeReport {
  readonly entries: readonly PayloadPackageSizeEntry[];
}

interface BitmapPayloadArtifact {
  readonly fontFixture: string;
  readonly bytes: number;
  readonly raster: {
    readonly decodedGpuBytes: number;
  };
}

interface MtsdfPayloadArtifact {
  readonly fontFixture: string;
  readonly compressed: {
    readonly bytes: number;
  };
  readonly raster: {
    readonly runtimeTextureArray: {
      readonly basePaddedGpuBytes: number;
    };
  };
}

interface SlugPayloadArtifact {
  readonly fontFixture: string;
  readonly compressed: {
    readonly bytes: number;
  };
  readonly raster: {
    readonly decodedGpuBytes: number;
  };
}

export interface PayloadFixtureManifests {
  readonly bitmap: {
    readonly artifacts: readonly BitmapPayloadArtifact[];
  };
  readonly mtsdf: {
    readonly artifacts: readonly MtsdfPayloadArtifact[];
  };
  readonly slug: {
    readonly artifacts: readonly SlugPayloadArtifact[];
  };
}

export type PayloadLiveStats =
  | {
      readonly technique: 'bitmap';
      readonly atlasGpuBytes: number;
      readonly sourceFontBytes: number;
    }
  | {
      readonly technique: 'mtsdf';
      readonly atlasGpuBytes: number;
      readonly sourceFontBytes: number;
    }
  | {
      readonly technique: 'slug';
      readonly slugGpuBytes: number;
      readonly sourceFontBytes: number;
    };

export interface PayloadSummaryMetric {
  readonly bytes: number | undefined;
  readonly label: 'Runtime' | 'Font asset' | 'Source font' | 'GPU' | 'Bake (lazy)';
  readonly valueKind: 'bytes' | 'gzip' | 'gpu';
}

export interface PayloadSummary {
  readonly runtime: PayloadSummaryMetric;
  readonly font: PayloadSummaryMetric;
  readonly gpu: PayloadSummaryMetric;
  readonly lazyBake?: PayloadSummaryMetric;
}

export interface CreatePayloadSummaryOptions {
  readonly delivery: FontDelivery;
  readonly fixtureManifests: PayloadFixtureManifests;
  readonly fontFixture: BenchmarkFontFixture;
  readonly liveStats?: PayloadLiveStats;
  readonly packageSizes: PayloadPackageSizeReport;
  readonly technique: RasterTechnique;
  readonly workload: string;
}

export function createPayloadSummary(options: CreatePayloadSummaryOptions): PayloadSummary {
  const { delivery, fixtureManifests, fontFixture, packageSizes, technique, workload } = options;
  const selectedFonts = liveWorkloadFontFixtures(workload, fontFixture);
  // A route delivers every fixture it keeps resident, not only the one it renders body text from. Icon Grid names its
  // label font beside its icon font; a composed route names the faces its spans select. Reporting only the primary
  // would under-report exactly the workloads that cost the most to deliver.
  const companionIds = isBenchmarkWorkloadId(workload)
    ? workloadCompanionFontFixtures(benchmarkWorkloadDefinition(workload).fontPolicy)
    : [];
  const fixtureIds = [
    ...new Set(
      selectedFonts.kind === 'icon-grid'
        ? [selectedFonts.primary, selectedFonts.labels]
        : [selectedFonts.primary, ...companionIds],
    ),
  ];
  const compatibleLiveStats = options.liveStats?.technique === technique ? options.liveStats : undefined;
  const runtime = measuredPackageSizeIfAvailable(packageSizes, `${technique}-runtime-js`);
  const shaper = measuredPackageSize(packageSizes, 'text-shaper-wasm');
  const runtimeBytes = runtime === undefined ? undefined : runtime.gzipBytes + shaper.gzipBytes;
  const manifestValues = fixturePayloadValues(technique, fixtureIds, fixtureManifests);
  const sourceFontBytes = delivery === 'runtime' ? compatibleLiveStats?.sourceFontBytes : manifestValues.transferBytes;
  const gpuBytes = liveGpuBytes(technique, compatibleLiveStats) ?? manifestValues.gpuBytes;
  const summary: PayloadSummary = {
    runtime: { bytes: runtimeBytes, label: 'Runtime', valueKind: 'gzip' },
    font: {
      bytes: sourceFontBytes,
      label: delivery === 'runtime' ? 'Source font' : 'Font asset',
      valueKind: delivery === 'baked' && technique !== 'bitmap' ? 'gzip' : 'bytes',
    },
    gpu: { bytes: gpuBytes, label: 'GPU', valueKind: 'gpu' },
  };
  if (delivery !== 'runtime') return summary;
  return {
    ...summary,
    lazyBake: {
      bytes: lazyBakeBytes(packageSizes, technique),
      label: 'Bake (lazy)',
      valueKind: 'gzip',
    },
  };
}

function fixturePayloadValues(
  technique: RasterTechnique,
  fixtureIds: readonly BenchmarkFontFixture[],
  manifests: PayloadFixtureManifests,
): { readonly transferBytes: number; readonly gpuBytes: number } {
  switch (technique) {
    case 'bitmap':
      return sumFixtureValues(fixtureIds, manifests.bitmap.artifacts, (fixture) => ({
        transferBytes: fixture.bytes,
        gpuBytes: fixture.raster.decodedGpuBytes,
      }));
    case 'mtsdf':
      return sumFixtureValues(fixtureIds, manifests.mtsdf.artifacts, (fixture) => ({
        transferBytes: fixture.compressed.bytes,
        gpuBytes: fixture.raster.runtimeTextureArray.basePaddedGpuBytes,
      }));
    case 'slug':
      return sumFixtureValues(fixtureIds, manifests.slug.artifacts, (fixture) => ({
        transferBytes: fixture.compressed.bytes,
        gpuBytes: fixture.raster.decodedGpuBytes,
      }));
  }
}

function sumFixtureValues<Fixture extends { readonly fontFixture: string }>(
  fixtureIds: readonly BenchmarkFontFixture[],
  fixtures: readonly Fixture[],
  values: (fixture: Fixture) => { readonly transferBytes: number; readonly gpuBytes: number },
): { readonly transferBytes: number; readonly gpuBytes: number } {
  let transferBytes = 0;
  let gpuBytes = 0;
  for (const fixtureId of fixtureIds) {
    const fixture = fixtures.find((candidate) => candidate.fontFixture === fixtureId);
    if (fixture === undefined) throw new Error(`Payload fixture manifest is missing ${fixtureId}`);
    const value = values(fixture);
    transferBytes += value.transferBytes;
    gpuBytes += value.gpuBytes;
  }
  return { transferBytes, gpuBytes };
}

function liveGpuBytes(technique: RasterTechnique, stats: PayloadLiveStats | undefined): number | undefined {
  if (stats === undefined) return undefined;
  if (technique === 'slug' && stats.technique === 'slug') return stats.slugGpuBytes;
  if (technique === 'mtsdf' && stats.technique === 'mtsdf') return stats.atlasGpuBytes;
  if (technique === 'bitmap' && stats.technique === 'bitmap') return stats.atlasGpuBytes;
  return undefined;
}

function lazyBakeBytes(packageSizes: PayloadPackageSizeReport, technique: RasterTechnique): number | undefined {
  const bakerHost = measuredPackageSizeIfAvailable(packageSizes, `${technique}-baker-js`);
  const bakerWasm = measuredPackageSizeIfAvailable(packageSizes, `${technique}-baker-wasm`);
  if (bakerHost === undefined || bakerWasm === undefined) return undefined;
  return (
    measuredPackageSize(packageSizes, 'runtime-baker-host-js').gzipBytes +
    measuredPackageSize(packageSizes, 'runtime-baker-worker-js').gzipBytes +
    measuredPackageSize(packageSizes, 'portable-baker-js').gzipBytes +
    measuredPackageSize(packageSizes, 'portable-baker-wasm').gzipBytes +
    bakerHost.gzipBytes +
    bakerWasm.gzipBytes
  );
}

function measuredPackageSize(
  packageSizes: PayloadPackageSizeReport,
  id: string,
): PayloadPackageSizeEntry & { readonly gzipBytes: number } {
  const entry = measuredPackageSizeIfAvailable(packageSizes, id);
  if (entry === undefined) throw new Error(`Missing measured package size: ${id}`);
  return entry;
}

function measuredPackageSizeIfAvailable(
  packageSizes: PayloadPackageSizeReport,
  id: string,
): (PayloadPackageSizeEntry & { readonly gzipBytes: number }) | undefined {
  const entry = packageSizes.entries.find((candidate) => candidate.id === id);
  if (entry?.status !== 'measured' || typeof entry.gzipBytes !== 'number') return undefined;
  return { ...entry, gzipBytes: entry.gzipBytes };
}
