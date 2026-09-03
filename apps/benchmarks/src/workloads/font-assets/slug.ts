import { slug as slugTechnique } from '@pmndrs/glyph/raster/slug';

import amiriCompressedFontUrl from '../../../fixtures/rendering/amiri-slug.font.glb.gz?url';
import dancingScriptCompressedFontUrl from '../../../fixtures/rendering/dancing-script-slug.font.glb.gz?url';
import dotGothicCompressedFontUrl from '../../../fixtures/rendering/dot-gothic-16-slug.font.glb.gz?url';
import fontAwesomeCompressedFontUrl from '../../../fixtures/rendering/font-awesome-free-6.7.2-slug.font.glb.gz?url';
import interCompressedFontUrl from '../../../fixtures/rendering/inter-slug.font.glb.gz?url';
import devanagariCompressedFontUrl from '../../../fixtures/rendering/noto-sans-devanagari-slug.font.glb.gz?url';
import notoCjkShowcaseCompressedFontUrl from '../../../fixtures/rendering/noto-sans-cjk-showcase-slug.font.glb.gz?url';
import sourceSerifCompressedFontUrl from '../../../fixtures/rendering/source-serif-4-slug.font.glb.gz?url';
import showcaseManifest from '../../../fixtures/rendering/showcase-slug-fixtures-v0.json' with { type: 'json' };
import type { BenchmarkFontFixture } from '../../benchmark/font-fixtures';
import type {
  AuthenticatedArtifactSize,
  BakedSlugArtifactSource,
  BenchmarkFontAsset,
  BenchmarkFontAssetRequest,
} from './contracts';
import { compiledSlugData } from './compiled-data';
import {
  createFontDeliveryMetrics,
  loadBakedFont,
  loadSourceFont,
  measuredRuntimeFontBake,
  preloadBakedFont,
  sourceUrlForFixture,
} from './runtime';

export type { BakedSlugArtifactSource, FontDeliveryMetrics } from './contracts';

export type SlugFontAsset = Extract<BenchmarkFontAsset, { readonly technique: 'slug' }>;

interface SlugFixtureManifest {
  readonly fontFixture: BenchmarkFontFixture;
  readonly compressed: AuthenticatedArtifactSize;
  readonly uncompressed: AuthenticatedArtifactSize;
}

const compressedFontUrls: Readonly<Record<BenchmarkFontFixture, string>> = {
  inter: interCompressedFontUrl,
  amiri: amiriCompressedFontUrl,
  'noto-sans-devanagari': devanagariCompressedFontUrl,
  'noto-sans-cjk-showcase': notoCjkShowcaseCompressedFontUrl,
  'dot-gothic-16': dotGothicCompressedFontUrl,
  'font-awesome-free-6.7.2': fontAwesomeCompressedFontUrl,
  'source-serif-4': sourceSerifCompressedFontUrl,
  'dancing-script': dancingScriptCompressedFontUrl,
};

const fixtureManifests = new Map(
  (showcaseManifest as { readonly artifacts: readonly SlugFixtureManifest[] }).artifacts.map((artifact) => [
    artifact.fontFixture,
    artifact,
  ]),
) as ReadonlyMap<BenchmarkFontFixture, SlugFixtureManifest>;

export async function preloadSlugFontAssets(
  fixtures: readonly BenchmarkFontFixture[],
  signal?: AbortSignal,
): Promise<void> {
  await Promise.all(
    fixtures.map((fixture) =>
      preloadBakedFont({
        artifact: compressedFontUrls[fixture],
        raster: slugTechnique(),
        ...(signal === undefined ? {} : { signal }),
      }),
    ),
  );
}

export async function loadSlugFontAsset(
  request: Extract<BenchmarkFontAssetRequest, { readonly technique: 'slug' }>,
): Promise<SlugFontAsset> {
  const { delivery, fixture, onProgress, signal } = request;
  signal?.throwIfAborted();
  const metrics = createFontDeliveryMetrics(delivery);
  if (delivery === 'runtime') {
    const loaded = await loadSourceFont({
      source: sourceUrlForFixture(fixture),
      raster: slugTechnique(),
      runtimeBake: measuredRuntimeFontBake(metrics, onProgress),
      ...(signal === undefined ? {} : { signal }),
    });
    return {
      technique: 'slug',
      artifactBytes: metrics.coreArtifactBytes,
      atlasGpuBytes: 0,
      compressedBytes: metrics.sourceFontBytes,
      loaded,
      data: compiledSlugData(loaded),
      metrics,
    };
  }
  const source = request.bakedArtifact ?? fixtureManifestSource(fixture);
  const loaded = await loadBakedFont({
    artifact: source.url,
    raster: slugTechnique(),
    ...(signal === undefined ? {} : { signal }),
  });
  return {
    technique: 'slug',
    artifactBytes: source.uncompressed.bytes,
    atlasGpuBytes: 0,
    compressedBytes: source.compressed.bytes,
    loaded,
    data: compiledSlugData(loaded),
    metrics,
  };
}

function fixtureManifestSource(fixture: BenchmarkFontFixture): BakedSlugArtifactSource {
  const manifest = fixtureManifests.get(fixture);
  if (manifest === undefined) throw new RangeError(`Unknown Slug font fixture: ${fixture}`);
  return { url: compressedFontUrls[fixture], compressed: manifest.compressed, uncompressed: manifest.uncompressed };
}
