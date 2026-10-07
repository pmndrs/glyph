import { bitmap as bitmapFormat, msdf as mtsdfFormat, slug as slugFormat } from '@pmndrs/glyph';
import bitmapUrl from '../../../fixtures/rendering/inter-outlines-bitmap-16-32.font.glb?url';
import mtsdfUrl from '../../../fixtures/rendering/inter-outlines-mtsdf.font.glb.gz?url';
import slugUrl from '../../../fixtures/rendering/inter-outlines-slug.font.glb.gz?url';
import manifest from '../../../fixtures/rendering/outline-fixtures-v0.json' with { type: 'json' };
import type { BenchmarkFontAssetRequest } from './contracts';
import { compiledBitmapData, compiledMsdfData, compiledSlugData } from './compiled-data';
import { createFontDeliveryMetrics, loadBakedFont, preloadBakedFont } from './runtime';
import type { BitmapFontAsset } from './bitmap';
import type { MtsdfFontAsset } from './mtsdf';
import type { SlugFontAsset } from './slug';

/**
 * The outlined Inter fixture in each raster format. Outlines come only from a bake that kept them, and the runtime
 * baker cannot, so these artifacts are baked ahead of time and a runtime-delivery request is refused rather than
 * silently served an outline-free font.
 */
const bitmapStrikes = [16, 32] as const;

function requireBaked(delivery: string): void {
  if (delivery !== 'baked') {
    throw new TypeError('the outlined Inter fixture is baked ahead of time; runtime delivery cannot keep outlines');
  }
}

export async function preloadOutlinedFontAsset(
  technique: 'bitmap' | 'mtsdf' | 'slug',
  signal?: AbortSignal,
): Promise<void> {
  const options = signal === undefined ? {} : { signal };
  if (technique === 'bitmap') {
    await preloadBakedFont({ artifact: bitmapUrl, raster: bitmapFormat({ strikes: bitmapStrikes }), ...options });
  } else if (technique === 'mtsdf') {
    await preloadBakedFont({ artifact: mtsdfUrl, raster: mtsdfFormat(), ...options });
  } else {
    await preloadBakedFont({ artifact: slugUrl, raster: slugFormat(), ...options });
  }
}

export async function loadOutlinedBitmapFontAsset(
  request: Extract<BenchmarkFontAssetRequest, { readonly technique: 'bitmap' }>,
): Promise<BitmapFontAsset> {
  requireBaked(request.delivery);
  request.signal?.throwIfAborted();
  const loaded = await loadBakedFont({
    artifact: bitmapUrl,
    raster: bitmapFormat({ strikes: bitmapStrikes }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  });
  const { bytes } = manifest.artifacts.bitmap;
  return {
    technique: 'bitmap',
    artifactBytes: bytes,
    atlasGpuBytes: 0,
    compressedBytes: bytes,
    loaded,
    data: compiledBitmapData(loaded),
    metrics: createFontDeliveryMetrics(request.delivery),
  };
}

export async function loadOutlinedMtsdfFontAsset(
  request: Extract<BenchmarkFontAssetRequest, { readonly technique: 'mtsdf' }>,
): Promise<MtsdfFontAsset> {
  requireBaked(request.delivery);
  request.signal?.throwIfAborted();
  const artifact = manifest.artifacts.mtsdf;
  const loaded = await loadBakedFont({
    artifact: mtsdfUrl,
    raster: mtsdfFormat(),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  });
  return {
    technique: 'mtsdf',
    artifactBytes: artifact.uncompressed.bytes,
    atlasGpuBytes: artifact.basePaddedGpuBytes,
    compressedBytes: artifact.compressed.bytes,
    loaded,
    data: compiledMsdfData(loaded, { ...artifact.configuration, planeUnitsPerEm: artifact.configuration.emSize }),
    metrics: createFontDeliveryMetrics(request.delivery),
  };
}

export async function loadOutlinedSlugFontAsset(
  request: Extract<BenchmarkFontAssetRequest, { readonly technique: 'slug' }>,
): Promise<SlugFontAsset> {
  requireBaked(request.delivery);
  request.signal?.throwIfAborted();
  const artifact = manifest.artifacts.slug;
  const loaded = await loadBakedFont({
    artifact: slugUrl,
    raster: slugFormat(),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  });
  return {
    technique: 'slug',
    artifactBytes: artifact.uncompressed.bytes,
    atlasGpuBytes: 0,
    compressedBytes: artifact.compressed.bytes,
    loaded,
    data: compiledSlugData(loaded),
    metrics: createFontDeliveryMetrics(request.delivery),
  };
}
