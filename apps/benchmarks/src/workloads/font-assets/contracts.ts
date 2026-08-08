import type { BakeProgressListener, FontRegistry, LoadedFont } from '@pmndrs/text';
import type { bitmap as bitmapTechnique } from '@pmndrs/text/raster/bitmap';
import type { msdf as mtsdfTechnique } from '@pmndrs/text/raster/msdf';
import type { slug as slugTechnique } from '@pmndrs/text/raster/slug';

import type { BenchmarkFontFixture } from '../../benchmark/font-fixtures';
import type { FontDelivery, RasterTechnique } from '../../benchmark/url-state';

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
  readonly registry?: FontRegistry | undefined;
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

/**
 * One fixture loaded exactly once through the target-v1 `FontLoader`. `loaded` owns the technique, its decoded raster
 * data, the registered font, and the text runtime, so every scene reads its font from `loaded.font` rather than from a
 * separately projected handle.
 */
export type BenchmarkFontAsset =
  | (CommonBenchmarkFontAsset & {
      readonly technique: 'bitmap';
      readonly loaded: LoadedFont<typeof bitmapTechnique>;
    })
  | (CommonBenchmarkFontAsset & {
      readonly technique: 'mtsdf';
      readonly loaded: LoadedFont<typeof mtsdfTechnique>;
    })
  | (CommonBenchmarkFontAsset & {
      readonly technique: 'slug';
      readonly loaded: LoadedFont<typeof slugTechnique>;
    });

export interface BenchmarkFontAssetPreloadRequest {
  readonly technique: RasterTechnique;
  readonly fixtures: readonly BenchmarkFontFixture[];
  readonly signal?: AbortSignal | undefined;
  readonly bitmapDensity?: BitmapFixtureDensity;
}
