import { mtsdf as mtsdfTechnique } from '@pmndrs/text/raster/mtsdf';

import amiriCompressedFontUrl from '../../../fixtures/rendering/amiri-mtsdf.font.glb.gz?url';
import dancingScriptCompressedFontUrl from '../../../fixtures/rendering/dancing-script-mtsdf.font.glb.gz?url';
import dotGothicCompressedFontUrl from '../../../fixtures/rendering/dot-gothic-16-mtsdf.font.glb.gz?url';
import fontAwesomeCompressedFontUrl from '../../../fixtures/rendering/font-awesome-free-6.7.2-mtsdf.font.glb.gz?url';
import interCompressedFontUrl from '../../../fixtures/rendering/inter-mtsdf.font.glb.gz?url';
import devanagariCompressedFontUrl from '../../../fixtures/rendering/noto-sans-devanagari-mtsdf.font.glb.gz?url';
import notoCjkShowcaseCompressedFontUrl from '../../../fixtures/rendering/noto-sans-cjk-showcase-mtsdf.font.glb.gz?url';
import sourceSerifCompressedFontUrl from '../../../fixtures/rendering/source-serif-4-mtsdf.font.glb.gz?url';
import showcaseManifest from '../../../fixtures/rendering/showcase-mtsdf-fixtures-v0.json';
import type { BenchmarkFontFixture } from '../../benchmark/font-fixtures';
import { fetchAuthenticatedGzipAsset, preloadFontAssetUrls } from './authenticated-gzip';
import type { AuthenticatedArtifactSize, BenchmarkFontAsset, BenchmarkFontAssetRequest } from './contracts';
import {
  createFontDeliveryMetrics,
  loadBakedFont,
  loadSourceFont,
  measuredRuntimeFontBake,
  measuredRuntimeRaster,
  sourceUrlForFixture,
} from './runtime';

export type { FontDeliveryMetrics } from './contracts';

export type MtsdfFontAsset = Extract<BenchmarkFontAsset, { readonly technique: 'mtsdf' }>;

interface MtsdfFixtureManifest {
  readonly fontFixture: BenchmarkFontFixture;
  readonly compressed: AuthenticatedArtifactSize;
  readonly uncompressed: AuthenticatedArtifactSize;
  readonly raster: { readonly runtimeTextureArray: { readonly basePaddedGpuBytes: number } };
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
  (showcaseManifest as { readonly artifacts: readonly MtsdfFixtureManifest[] }).artifacts.map((artifact) => [
    artifact.fontFixture,
    artifact,
  ]),
) as ReadonlyMap<BenchmarkFontFixture, MtsdfFixtureManifest>;

export const MTSDF_FIXTURE_ARTIFACT_BYTE_LIMIT = Math.max(
  ...Array.from(fixtureManifests.values(), ({ uncompressed }) => uncompressed.bytes),
);

export async function preloadMtsdfFontAssets(
  fixtures: readonly BenchmarkFontFixture[],
  signal?: AbortSignal,
): Promise<void> {
  await preloadFontAssetUrls(
    fixtures.map((fixture) => compressedFontUrls[fixture]),
    'MTSDF font fixture',
    signal,
  );
}

export async function loadMtsdfFontAsset(
  request: Extract<BenchmarkFontAssetRequest, { readonly technique: 'mtsdf' }>,
): Promise<MtsdfFontAsset> {
  const { delivery, fixture, onProgress, registry, signal } = request;
  signal?.throwIfAborted();
  const metrics = createFontDeliveryMetrics(delivery);
  const manifest = fixtureManifests.get(fixture);
  if (manifest === undefined) throw new RangeError(`Unknown MTSDF font fixture: ${fixture}`);
  if (delivery === 'runtime') {
    const loaded = await loadSourceFont({
      source: sourceUrlForFixture(fixture),
      raster: { technique: measuredMtsdfTechnique(metrics, onProgress) },
      runtimeBake: measuredRuntimeFontBake(metrics, onProgress),
      registry,
      ...(signal === undefined ? {} : { signal }),
    });
    return {
      technique: 'mtsdf',
      artifactBytes: metrics.coreArtifactBytes,
      atlasGpuBytes: 0,
      compressedBytes: metrics.sourceFontBytes,
      loaded,
      metrics,
    };
  }
  const artifact = await fetchAuthenticatedGzipAsset(
    compressedFontUrls[fixture],
    manifest,
    'MTSDF font fixture',
    signal,
  );
  const loaded = await loadBakedFont({
    artifact,
    raster: { technique: mtsdfTechnique },
    registry,
    ...(signal === undefined ? {} : { signal }),
  });
  return {
    technique: 'mtsdf',
    artifactBytes: artifact.byteLength,
    atlasGpuBytes: manifest.raster.runtimeTextureArray.basePaddedGpuBytes,
    compressedBytes: manifest.compressed.bytes,
    loaded,
    metrics,
  };
}

/**
 * Clones the technique with an instrumented runtime baker. The Three adapter resolves a program by technique ID rather
 * than object identity, so the clone still renders while reporting the same raster delivery evidence.
 */
function measuredMtsdfTechnique(
  metrics: BenchmarkFontAsset['metrics'],
  onProgress?: Extract<BenchmarkFontAssetRequest, { readonly technique: 'mtsdf' }>['onProgress'],
): typeof mtsdfTechnique {
  const runtimeBaker = measuredRuntimeRaster(mtsdfTechnique.runtimeBaker, metrics, onProgress);
  return { ...mtsdfTechnique, ...(runtimeBaker === undefined ? {} : { runtimeBaker }) };
}
