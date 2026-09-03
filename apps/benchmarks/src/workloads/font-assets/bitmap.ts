import { bitmap as bitmapTechnique } from '@pmndrs/glyph/raster/bitmap';

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
import densityManifest from '../../../fixtures/rendering/showcase-bitmap-density-fixtures-v0.json' with { type: 'json' };
import conformanceManifest from '../../../fixtures/rendering/showcase-raster-fixtures-v0.json' with { type: 'json' };
import type { BenchmarkFontFixture } from '../../benchmark/font-fixtures';
import type { BenchmarkFontAsset, BenchmarkFontAssetRequest, BitmapFixtureDensity } from './contracts';
import { compiledBitmapData } from './compiled-data';
import {
  createFontDeliveryMetrics,
  loadBakedFont,
  loadSourceFont,
  measuredRuntimeFontBake,
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

const conformanceArtifactBytes = artifactByteMap(conformanceManifest);
const densityArtifactBytes = artifactByteMap(densityManifest);

export async function preloadBitmapFontAssets(
  fixtures: readonly BenchmarkFontFixture[],
  density: BitmapFixtureDensity = 'live',
  signal?: AbortSignal,
): Promise<void> {
  const urls = density === 'live' ? bitmapDensityFontUrls : bitmapFontUrls;
  const strikes = density === 'live' ? liveStrikes : conformanceStrikes;
  await Promise.all(
    fixtures.map(async (fixture) => {
      const font = await loadBakedFont({
        artifact: urls[fixture],
        raster: { raster: bitmapTechnique, options: { strikes } },
        ...(signal === undefined ? {} : { signal }),
      });
      font.dispose();
    }),
  );
}

export async function loadBitmapFontAsset(
  request: Extract<BenchmarkFontAssetRequest, { readonly technique: 'bitmap' }>,
): Promise<BitmapFontAsset> {
  const { bitmapDensity, delivery, fixture, onProgress, signal } = request;
  signal?.throwIfAborted();
  const metrics = createFontDeliveryMetrics(delivery);
  const strikes = bitmapDensity === 'live' ? liveStrikes : conformanceStrikes;
  if (delivery === 'runtime') {
    const loaded = await loadSourceFont({
      source: sourceUrlForFixture(fixture),
      raster: { raster: bitmapTechnique, options: { strikes } },
      runtimeBake: measuredRuntimeFontBake(metrics, onProgress),
      ...(signal === undefined ? {} : { signal }),
    });
    return {
      technique: 'bitmap',
      artifactBytes: metrics.coreArtifactBytes,
      atlasGpuBytes: 0,
      compressedBytes: metrics.sourceFontBytes,
      loaded,
      data: compiledBitmapData(loaded),
      metrics,
    };
  }
  const urls = bitmapDensity === 'live' ? bitmapDensityFontUrls : bitmapFontUrls;
  const artifactBytes = (bitmapDensity === 'live' ? densityArtifactBytes : conformanceArtifactBytes).get(fixture);
  if (artifactBytes === undefined) throw new RangeError(`Unknown bitmap font fixture: ${fixture}`);
  const loaded = await loadBakedFont({
    artifact: urls[fixture],
    raster: { raster: bitmapTechnique, options: { strikes } },
    ...(signal === undefined ? {} : { signal }),
  });
  return {
    technique: 'bitmap',
    artifactBytes,
    atlasGpuBytes: 0,
    compressedBytes: artifactBytes,
    loaded,
    data: compiledBitmapData(loaded),
    metrics,
  };
}

function artifactByteMap(manifest: {
  readonly artifacts: readonly { readonly fontFixture: string; readonly bytes: number }[];
}): ReadonlyMap<string, number> {
  return new Map(manifest.artifacts.map((artifact) => [artifact.fontFixture, artifact.bytes]));
}
