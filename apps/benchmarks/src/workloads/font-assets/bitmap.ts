import { defineRaster, FontRegistry } from '@pmndrs/text';
import { bitmap, type BitmapModule } from '@pmndrs/text/raster/bitmap';

import amiriBitmapFontUrl from '../../../fixtures/rendering/amiri-bitmap-16.font.glb?url';
import amiriBitmapDensityFontUrl from '../../../fixtures/rendering/amiri-bitmap-16-32.font.glb?url';
import dancingScriptBitmapFontUrl from '../../../fixtures/rendering/dancing-script-bitmap-16.font.glb?url';
import dancingScriptBitmapDensityFontUrl from '../../../fixtures/rendering/dancing-script-bitmap-16-32.font.glb?url';
import dotGothicBitmapFontUrl from '../../../fixtures/rendering/dot-gothic-16-bitmap-16.font.glb?url';
import dotGothicBitmapDensityFontUrl from '../../../fixtures/rendering/dot-gothic-16-bitmap-16-32.font.glb?url';
import fontAwesomeBitmapFontUrl from '../../../fixtures/rendering/font-awesome-free-6.7.2-bitmap-16.font.glb?url';
import fontAwesomeBitmapDensityFontUrl from '../../../fixtures/rendering/font-awesome-free-6.7.2-bitmap-16-32.font.glb?url';
import interBitmapFontUrl from '../../../fixtures/rendering/inter-bitmap-16.font.glb?url';
import interBitmapDensityFontUrl from '../../../fixtures/rendering/inter-bitmap-16-32.font.glb?url';
import devanagariBitmapFontUrl from '../../../fixtures/rendering/noto-sans-devanagari-bitmap-16.font.glb?url';
import devanagariBitmapDensityFontUrl from '../../../fixtures/rendering/noto-sans-devanagari-bitmap-16-32.font.glb?url';
import notoCjkShowcaseBitmapFontUrl from '../../../fixtures/rendering/noto-sans-cjk-showcase-bitmap-16.font.glb?url';
import notoCjkShowcaseBitmapDensityFontUrl from '../../../fixtures/rendering/noto-sans-cjk-showcase-bitmap-16-32.font.glb?url';
import sourceSerifBitmapFontUrl from '../../../fixtures/rendering/source-serif-4-bitmap-16.font.glb?url';
import sourceSerifBitmapDensityFontUrl from '../../../fixtures/rendering/source-serif-4-bitmap-16-32.font.glb?url';
import type { BenchmarkFontFixture } from '../../benchmark/font-fixtures';
import { preloadFontAssetUrls } from './authenticated-gzip';
import type { BenchmarkFontAsset, BenchmarkFontAssetRequest, BitmapFixtureDensity } from './contracts';
import { createFontDeliveryMetrics, loadRuntimeCoreFont, measuredRuntimeRaster, sourceUrlForFixture } from './runtime';

export type { BitmapFixtureDensity, FontDeliveryMetrics } from './contracts';

export type BitmapFontAsset = Omit<BenchmarkFontAsset, 'raster' | 'technique'> & {
  readonly technique: 'bitmap';
  readonly raster: ReturnType<typeof bitmap>;
};

const bitmapRequest = bitmap({ strikes: [16] as const });
const liveBitmapRequest = bitmap({ strikes: [16, 32] as const });

const bitmapFontUrls: Readonly<Record<BenchmarkFontFixture, string>> = {
  inter: interBitmapFontUrl,
  amiri: amiriBitmapFontUrl,
  'noto-sans-devanagari': devanagariBitmapFontUrl,
  'noto-sans-cjk-showcase': notoCjkShowcaseBitmapFontUrl,
  'dot-gothic-16': dotGothicBitmapFontUrl,
  'font-awesome-free-6.7.2': fontAwesomeBitmapFontUrl,
  'source-serif-4': sourceSerifBitmapFontUrl,
  'dancing-script': dancingScriptBitmapFontUrl,
};

const bitmapDensityFontUrls: Readonly<Record<BenchmarkFontFixture, string>> = {
  inter: interBitmapDensityFontUrl,
  amiri: amiriBitmapDensityFontUrl,
  'noto-sans-devanagari': devanagariBitmapDensityFontUrl,
  'noto-sans-cjk-showcase': notoCjkShowcaseBitmapDensityFontUrl,
  'dot-gothic-16': dotGothicBitmapDensityFontUrl,
  'font-awesome-free-6.7.2': fontAwesomeBitmapDensityFontUrl,
  'source-serif-4': sourceSerifBitmapDensityFontUrl,
  'dancing-script': dancingScriptBitmapDensityFontUrl,
};

export async function preloadBitmapFontAssets(
  fixtures: readonly BenchmarkFontFixture[],
  density: BitmapFixtureDensity = 'live',
  signal?: AbortSignal,
): Promise<void> {
  const urls = density === 'live' ? bitmapDensityFontUrls : bitmapFontUrls;
  await preloadFontAssetUrls(
    fixtures.map((fixture) => urls[fixture]),
    'bitmap font fixture',
    signal,
  );
}

export async function loadBitmapFontAsset(
  request: Extract<BenchmarkFontAssetRequest, { readonly technique: 'bitmap' }>,
): Promise<BitmapFontAsset> {
  const { bitmapDensity, delivery, fixture, onProgress, registry, signal } = request;
  signal?.throwIfAborted();
  const metrics = createFontDeliveryMetrics(delivery);
  const raster = bitmapDensity === 'live' ? liveBitmapRequest : bitmapRequest;
  if (delivery === 'runtime') {
    const font = await loadRuntimeCoreFont({
      source: sourceUrlForFixture(fixture),
      metrics,
      registry: registry ?? new FontRegistry(),
      ...(signal === undefined ? {} : { signal }),
      ...(onProgress === undefined ? {} : { onProgress }),
    });
    return {
      technique: 'bitmap',
      artifactBytes: metrics.coreArtifactBytes,
      atlasGpuBytes: 0,
      compressedBytes: metrics.sourceFontBytes,
      font,
      metrics,
      raster: measuredBitmapRaster(raster, metrics, onProgress),
    };
  }
  let font: Awaited<ReturnType<FontRegistry['registerAsset']>> | undefined;
  try {
    const urls = bitmapDensity === 'live' ? bitmapDensityFontUrls : bitmapFontUrls;
    const response = await fetch(urls[fixture], signal === undefined ? undefined : { signal });
    if (!response.ok) throw new Error(`Unable to load bitmap font fixture (${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    signal?.throwIfAborted();
    font = await (registry ?? new FontRegistry()).registerAsset(bytes);
    signal?.throwIfAborted();
    return {
      technique: 'bitmap',
      artifactBytes: bytes.byteLength,
      atlasGpuBytes: 0,
      compressedBytes: bytes.byteLength,
      font,
      metrics,
      raster,
    };
  } catch (error) {
    font?.dispose();
    throw error;
  }
}

function measuredBitmapRaster(
  request: ReturnType<typeof bitmap>,
  metrics: BenchmarkFontAsset['metrics'],
  onProgress?: Extract<BenchmarkFontAssetRequest, { readonly technique: 'bitmap' }>['onProgress'],
): ReturnType<typeof bitmap> {
  const runtimeBaker = measuredRuntimeRaster(request.module.runtimeBaker, metrics, onProgress);
  const module: BitmapModule = defineRaster({
    ...request.module,
    ...(runtimeBaker === undefined ? {} : { runtimeBaker }),
  });
  return { module, options: request.options };
}
