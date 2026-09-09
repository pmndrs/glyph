import type { BakeProgressListener, Font } from '@pmndrs/glyph';
import type { bitmap as bitmapFormat, BitmapData } from '@pmndrs/glyph/raster/bitmap';
import type { msdf as mtsdfFormat, MsdfData } from '@pmndrs/glyph/raster/msdf';
import type { slug as slugFormat } from '@pmndrs/glyph/raster/slug';

import type { BenchmarkFontFixture } from '../../benchmark/font-fixtures';
import type { SlugCpuReferenceData } from '../../benchmark/low-level/raster/slug-cpu-reference';
import type { FontDelivery, RasterFormatName } from '../../benchmark/url-state';

export type BitmapFixtureDensity = 'conformance' | 'live';

export interface AuthenticatedArtifactSize {
  readonly bytes: number;
  readonly sha256: string;
}

/** An authenticated non-production Slug fixture used only by the comparison candidate lane. */
export interface BakedSlugArtifactSource {
  readonly url: string;
  readonly compressed: AuthenticatedArtifactSize;
  readonly uncompressed: AuthenticatedArtifactSize;
}

/** Mutable measurements populated by the selected public loader and optional runtime baker. */
export interface FontDeliveryMetrics {
  readonly delivery: FontDelivery;
  sourceFontBytes: number;
  coreArtifactBytes: number;
  coreBakeMs: number;
  rasterArtifactBytes: number;
  rasterBakeMs: number;
  rasterGpuBytes: number;
}

interface CommonBenchmarkFontAssetRequest {
  readonly fixture: BenchmarkFontFixture;
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: BakeProgressListener | undefined;
}

export type BenchmarkFontAssetRequest =
  | (CommonBenchmarkFontAssetRequest & {
      readonly technique: 'bitmap';
      readonly delivery: FontDelivery;
      readonly bitmapDensity: BitmapFixtureDensity;
    })
  | (CommonBenchmarkFontAssetRequest & {
      readonly technique: 'mtsdf';
      readonly delivery: FontDelivery;
    })
  | (CommonBenchmarkFontAssetRequest & {
      readonly technique: 'slug';
      readonly delivery: 'runtime';
    })
  | (CommonBenchmarkFontAssetRequest & {
      readonly technique: 'slug';
      readonly delivery: 'baked';
      readonly bakedArtifact?: BakedSlugArtifactSource;
    });

interface CommonBenchmarkFontAsset {
  readonly artifactBytes: number;
  readonly atlasGpuBytes: number;
  readonly compressedBytes: number;
  readonly metrics: FontDeliveryMetrics;
}

/** One fixture loaded once through the shared font graph: `loaded` is the canonical Font lease, `data` is a CPU-oracle view reconstructed from the same compiled binding and portable payloads. */
export type BenchmarkFontAsset =
  | (CommonBenchmarkFontAsset & {
      readonly technique: 'bitmap';
      readonly loaded: Font<typeof bitmapFormat>;
      readonly data: BitmapData;
    })
  | (CommonBenchmarkFontAsset & {
      readonly technique: 'mtsdf';
      readonly loaded: Font<typeof mtsdfFormat>;
      readonly data: MsdfData;
    })
  | (CommonBenchmarkFontAsset & {
      readonly technique: 'slug';
      readonly loaded: Font<typeof slugFormat>;
      readonly data: SlugCpuReferenceData;
    });

export interface BenchmarkFontAssetPreloadRequest {
  readonly technique: RasterFormatName;
  readonly fixtures: readonly BenchmarkFontFixture[];
  readonly signal?: AbortSignal | undefined;
  readonly bitmapDensity?: BitmapFixtureDensity;
}
