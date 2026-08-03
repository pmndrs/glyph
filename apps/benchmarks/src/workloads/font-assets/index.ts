import type { BenchmarkFontAsset, BenchmarkFontAssetPreloadRequest, BenchmarkFontAssetRequest } from './contracts';

export type {
  AuthenticatedArtifactSize,
  BakedSlugArtifactSource,
  BenchmarkFontAsset,
  BenchmarkFontAssetPreloadRequest,
  BenchmarkFontAssetRequest,
  BitmapFixtureDensity,
  FontDeliveryMetrics,
} from './contracts';

/** Loads one fixture through public @pmndrs/text loader and raster entrypoints for the selected technique only. */
export async function loadBenchmarkFontAsset(request: BenchmarkFontAssetRequest): Promise<BenchmarkFontAsset> {
  switch (request.technique) {
    case 'bitmap':
      return (await import('./bitmap')).loadBitmapFontAsset(request);
    case 'mtsdf':
      return (await import('./mtsdf')).loadMtsdfFontAsset(request);
    case 'slug':
      return (await import('./slug')).loadSlugFontAsset(request);
  }
}

/** Preloads only transport assets; runtime delivery intentionally has no prebuilt fixture payload to fetch. */
export async function preloadBenchmarkFontAssets(request: BenchmarkFontAssetPreloadRequest): Promise<void> {
  switch (request.technique) {
    case 'bitmap':
      return (await import('./bitmap')).preloadBitmapFontAssets(
        request.fixtures,
        request.bitmapDensity ?? 'live',
        request.signal,
      );
    case 'mtsdf':
      return (await import('./mtsdf')).preloadMtsdfFontAssets(request.fixtures, request.signal);
    case 'slug':
      return (await import('./slug')).preloadSlugFontAssets(request.fixtures, request.signal);
  }
}
