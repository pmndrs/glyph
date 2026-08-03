import type { AnyRasterInput, BakeProgressListener, FontRegistry, RegisteredFont } from '@pmndrs/text';

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

export interface BenchmarkFontAsset {
  readonly technique: RasterTechnique;
  readonly artifactBytes: number;
  readonly atlasGpuBytes: number;
  readonly compressedBytes: number;
  readonly font: RegisteredFont;
  readonly metrics: FontDeliveryMetrics;
  readonly raster: AnyRasterInput;
}

export interface BenchmarkFontAssetPreloadRequest {
  readonly technique: RasterTechnique;
  readonly fixtures: readonly BenchmarkFontFixture[];
  readonly signal?: AbortSignal | undefined;
  readonly bitmapDensity?: BitmapFixtureDensity;
}
