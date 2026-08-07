import { FontRegistry, defineRaster } from '@pmndrs/text';
import { slug, type SlugModule } from '@pmndrs/text/raster/slug/v0';

import amiriCompressedFontUrl from '../../../fixtures/rendering/amiri-slug.font.glb.gz?url';
import dancingScriptCompressedFontUrl from '../../../fixtures/rendering/dancing-script-slug.font.glb.gz?url';
import dotGothicCompressedFontUrl from '../../../fixtures/rendering/dot-gothic-16-slug.font.glb.gz?url';
import fontAwesomeCompressedFontUrl from '../../../fixtures/rendering/font-awesome-free-6.7.2-slug.font.glb.gz?url';
import interCompressedFontUrl from '../../../fixtures/rendering/inter-slug.font.glb.gz?url';
import devanagariCompressedFontUrl from '../../../fixtures/rendering/noto-sans-devanagari-slug.font.glb.gz?url';
import notoCjkShowcaseCompressedFontUrl from '../../../fixtures/rendering/noto-sans-cjk-showcase-slug.font.glb.gz?url';
import sourceSerifCompressedFontUrl from '../../../fixtures/rendering/source-serif-4-slug.font.glb.gz?url';
import showcaseManifest from '../../../fixtures/rendering/showcase-slug-fixtures-v0.json';
import type { BenchmarkFontFixture } from '../../benchmark/font-fixtures';
import { fetchAuthenticatedGzipAsset, preloadFontAssetUrls } from './authenticated-gzip';
import type {
  AuthenticatedArtifactSize,
  BakedSlugArtifactSource,
  BenchmarkFontAsset,
  BenchmarkFontAssetRequest,
} from './contracts';
import { createFontDeliveryMetrics, measuredRuntimeRaster, loadRuntimeCoreFont, sourceUrlForFixture } from './runtime';

export type { BakedSlugArtifactSource, FontDeliveryMetrics } from './contracts';

export type SlugFontAsset = Omit<BenchmarkFontAsset, 'raster' | 'technique'> & {
  readonly technique: 'slug';
  readonly raster: SlugModule;
};

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
  await preloadFontAssetUrls(
    fixtures.map((fixture) => compressedFontUrls[fixture]),
    'Slug font fixture',
    signal,
  );
}

export async function loadSlugFontAsset(
  request: Extract<BenchmarkFontAssetRequest, { readonly technique: 'slug' }>,
): Promise<SlugFontAsset> {
  const { delivery, fixture, onProgress, registry, signal } = request;
  signal?.throwIfAborted();
  const metrics = createFontDeliveryMetrics(delivery);
  if (delivery === 'runtime') {
    const font = await loadRuntimeCoreFont({
      source: sourceUrlForFixture(fixture),
      metrics,
      registry: registry ?? new FontRegistry(),
      ...(signal === undefined ? {} : { signal }),
      ...(onProgress === undefined ? {} : { onProgress }),
    });
    return {
      technique: 'slug',
      artifactBytes: metrics.coreArtifactBytes,
      atlasGpuBytes: 0,
      compressedBytes: metrics.sourceFontBytes,
      font,
      metrics,
      raster: measuredSlugRaster(metrics, onProgress),
    };
  }
  const source = request.bakedArtifact ?? fixtureManifestSource(fixture);
  const artifact = await fetchAuthenticatedGzipAsset(source.url, source, 'Slug font fixture', signal);
  let font: Awaited<ReturnType<FontRegistry['registerAsset']>> | undefined;
  try {
    font = await (registry ?? new FontRegistry({ maxArtifactBytes: source.uncompressed.bytes })).registerAsset(
      artifact,
    );
    signal?.throwIfAborted();
    return {
      technique: 'slug',
      artifactBytes: artifact.byteLength,
      atlasGpuBytes: 0,
      compressedBytes: source.compressed.bytes,
      font,
      metrics,
      raster: slug,
    };
  } catch (error) {
    font?.dispose();
    throw error;
  }
}

function fixtureManifestSource(fixture: BenchmarkFontFixture): BakedSlugArtifactSource {
  const manifest = fixtureManifests.get(fixture);
  if (manifest === undefined) throw new RangeError(`Unknown Slug font fixture: ${fixture}`);
  return { url: compressedFontUrls[fixture], compressed: manifest.compressed, uncompressed: manifest.uncompressed };
}

function measuredSlugRaster(
  metrics: BenchmarkFontAsset['metrics'],
  onProgress?: Extract<BenchmarkFontAssetRequest, { readonly technique: 'slug' }>['onProgress'],
): SlugModule {
  const runtimeBaker = measuredRuntimeRaster(slug.runtimeBaker, metrics, onProgress);
  return defineRaster({ ...slug, ...(runtimeBaker === undefined ? {} : { runtimeBaker }) });
}
