import { msdf as mtsdfTechnique } from '@pmndrs/glyph/raster/msdf';
import { MSDF_EM_SIZE, MSDF_PIXEL_RANGE } from '@pmndrs/glyph/raster/msdf';

import amiriCompressedFontUrl from '../../../fixtures/rendering/amiri-mtsdf.font.glb.gz?url';
import dancingScriptCompressedFontUrl from '../../../fixtures/rendering/dancing-script-mtsdf.font.glb.gz?url';
import dotGothicCompressedFontUrl from '../../../fixtures/rendering/dot-gothic-16-mtsdf.font.glb.gz?url';
import fontAwesomeCompressedFontUrl from '../../../fixtures/rendering/font-awesome-free-6.7.2-mtsdf.font.glb.gz?url';
import interCompressedFontUrl from '../../../fixtures/rendering/inter-mtsdf.font.glb.gz?url';
import devanagariCompressedFontUrl from '../../../fixtures/rendering/noto-sans-devanagari-mtsdf.font.glb.gz?url';
import notoCjkShowcaseCompressedFontUrl from '../../../fixtures/rendering/noto-sans-cjk-showcase-mtsdf.font.glb.gz?url';
import sourceSerifCompressedFontUrl from '../../../fixtures/rendering/source-serif-4-mtsdf.font.glb.gz?url';
import showcaseManifest from '../../../fixtures/rendering/showcase-mtsdf-fixtures-v0.json' with { type: 'json' };
import type { BenchmarkFontFixture } from '../../benchmark/font-fixtures';
import type { BenchmarkFontAsset, BenchmarkFontAssetRequest } from './contracts';
import { compiledMsdfData } from './compiled-data';
import {
  createFontDeliveryMetrics,
  loadBakedFont,
  loadSourceFont,
  measuredRuntimeFontBake,
  sourceUrlForFixture,
} from './runtime';

export type { FontDeliveryMetrics } from './contracts';

export type MtsdfFontAsset = Extract<BenchmarkFontAsset, { readonly technique: 'mtsdf' }>;

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

const fixtureManifests = new Map(showcaseManifest.artifacts.map((artifact) => [artifact.fontFixture, artifact]));

export async function preloadMtsdfFontAssets(
  fixtures: readonly BenchmarkFontFixture[],
  signal?: AbortSignal,
): Promise<void> {
  await Promise.all(
    fixtures.map(async (fixture) => {
      const font = await loadBakedFont({
        artifact: compressedFontUrls[fixture],
        raster: { raster: mtsdfTechnique },
        ...(signal === undefined ? {} : { signal }),
      });
      font.dispose();
    }),
  );
}

export async function loadMtsdfFontAsset(
  request: Extract<BenchmarkFontAssetRequest, { readonly technique: 'mtsdf' }>,
): Promise<MtsdfFontAsset> {
  const { delivery, fixture, onProgress, signal } = request;
  signal?.throwIfAborted();
  const metrics = createFontDeliveryMetrics(delivery);
  const manifest = fixtureManifests.get(fixture);
  if (manifest === undefined) throw new RangeError(`Unknown MTSDF font fixture: ${fixture}`);
  const configuration = { ...manifest.configuration, planeUnitsPerEm: manifest.configuration.emSize };
  if (delivery === 'runtime') {
    if (configuration.emSize !== MSDF_EM_SIZE || configuration.pixelRange !== MSDF_PIXEL_RANGE) {
      throw new TypeError('runtime MTSDF fixture configuration must match the default bake request');
    }
    const loaded = await loadSourceFont({
      source: sourceUrlForFixture(fixture),
      raster: { raster: mtsdfTechnique },
      runtimeBake: measuredRuntimeFontBake(metrics, onProgress),
      ...(signal === undefined ? {} : { signal }),
    });
    return {
      technique: 'mtsdf',
      artifactBytes: metrics.coreArtifactBytes,
      atlasGpuBytes: 0,
      compressedBytes: metrics.sourceFontBytes,
      loaded,
      data: compiledMsdfData(loaded, configuration),
      metrics,
    };
  }
  const loaded = await loadBakedFont({
    artifact: compressedFontUrls[fixture],
    raster: { raster: mtsdfTechnique },
    ...(signal === undefined ? {} : { signal }),
  });
  return {
    technique: 'mtsdf',
    artifactBytes: manifest.uncompressed.bytes,
    atlasGpuBytes: manifest.raster.runtimeTextureArray.basePaddedGpuBytes,
    compressedBytes: manifest.compressed.bytes,
    loaded,
    data: compiledMsdfData(loaded, configuration),
    metrics,
  };
}
