import type { BakeProgressListener, FontRegistry, LoadedFont, RegisteredFont } from '@pmndrs/text';
import type { bitmap as bitmapTechnique } from '@pmndrs/text/raster/bitmap';
import type { bitmap as bitmapRaster } from '@pmndrs/text/raster/bitmap/v0';
import type { MsdfModule } from '@pmndrs/text/raster/msdf';
import type { mtsdf as mtsdfTechnique } from '@pmndrs/text/raster/mtsdf';
import type { slug as slugTechnique } from '@pmndrs/text/raster/slug';
import type { SlugModule } from '@pmndrs/text/raster/slug/v0';

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
  /**
   * The registered font `loaded` owns. It is not a second load: the target-v1 loader registers into the caller's
   * registry, so this is the same `RegisteredFont` every merged-v0 scene already renders from. Scenes migrate to
   * `loaded` one lane at a time, and this projection keeps the ones that have not moved yet working unchanged.
   */
  readonly font: RegisteredFont;
  readonly metrics: FontDeliveryMetrics;
}

/**
 * One fixture loaded exactly once through the target-v1 `FontLoader`. `loaded` owns the technique, its decoded raster
 * data, and the text runtime; `raster` remains the merged-v0 module the unmigrated scenes still pass to `Text`. Both
 * resolve the same raster key, so the module reuses the raster the load already attached rather than baking again.
 */
export type BenchmarkFontAsset =
  | (CommonBenchmarkFontAsset & {
      readonly technique: 'bitmap';
      readonly loaded: LoadedFont<typeof bitmapTechnique>;
      readonly raster: ReturnType<typeof bitmapRaster>;
    })
  | (CommonBenchmarkFontAsset & {
      readonly technique: 'mtsdf';
      readonly loaded: LoadedFont<typeof mtsdfTechnique>;
      readonly raster: MsdfModule;
    })
  | (CommonBenchmarkFontAsset & {
      readonly technique: 'slug';
      readonly loaded: LoadedFont<typeof slugTechnique>;
      readonly raster: SlugModule;
    });

export interface BenchmarkFontAssetPreloadRequest {
  readonly technique: RasterTechnique;
  readonly fixtures: readonly BenchmarkFontFixture[];
  readonly signal?: AbortSignal | undefined;
  readonly bitmapDensity?: BitmapFixtureDensity;
}
