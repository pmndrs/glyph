import { bitmap as bitmapTechnique } from '@pmndrs/text/raster/bitmap';

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
import {
  createFontDeliveryMetrics,
  loadBakedFont,
  loadSourceFont,
  measuredRuntimeFontBake,
  measuredRuntimeRaster,
  sourceUrlForFixture,
} from './runtime';

export type { BitmapFixtureDensity, FontDeliveryMetrics } from './contracts';

export type BitmapFontAsset = Extract<BenchmarkFontAsset, { readonly technique: 'bitmap' }>;

const conformanceStrikes = [16] as const;
const liveStrikes = [16, 32] as const;

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
  const strikes = bitmapDensity === 'live' ? liveStrikes : conformanceStrikes;
  if (delivery === 'runtime') {
    const loaded = await loadSourceFont({
      source: sourceUrlForFixture(fixture),
      raster: { technique: measuredBitmapTechnique(metrics, onProgress), options: { strikes } },
      runtimeBake: measuredRuntimeFontBake(metrics, onProgress),
      registry,
      ...(signal === undefined ? {} : { signal }),
    });
    return {
      technique: 'bitmap',
      artifactBytes: metrics.coreArtifactBytes,
      atlasGpuBytes: 0,
      compressedBytes: metrics.sourceFontBytes,
      loaded,
      metrics,
    };
  }
  const urls = bitmapDensity === 'live' ? bitmapDensityFontUrls : bitmapFontUrls;
  const response = await fetch(urls[fixture], signal === undefined ? undefined : { signal });
  if (!response.ok) throw new Error(`Unable to load bitmap font fixture (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  signal?.throwIfAborted();
  const loaded = await loadBakedFont({
    artifact: bytes,
    raster: { technique: bitmapTechnique, options: { strikes } },
    registry,
    ...(signal === undefined ? {} : { signal }),
  });
  return {
    technique: 'bitmap',
    artifactBytes: bytes.byteLength,
    atlasGpuBytes: 0,
    compressedBytes: bytes.byteLength,
    loaded,
    metrics,
  };
}

/**
 * Clones the technique with an instrumented runtime baker. The Three adapter resolves a program by technique ID rather
 * than object identity, so the clone still renders while reporting the same raster delivery evidence.
 */
function measuredBitmapTechnique(
  metrics: BenchmarkFontAsset['metrics'],
  onProgress?: Extract<BenchmarkFontAssetRequest, { readonly technique: 'bitmap' }>['onProgress'],
): typeof bitmapTechnique {
  const runtimeBaker = measuredRuntimeRaster(bitmapTechnique.runtimeBaker, metrics, onProgress);
  return { ...bitmapTechnique, ...(runtimeBaker === undefined ? {} : { runtimeBaker }) };
}
