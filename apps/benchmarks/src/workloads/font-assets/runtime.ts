import {
  type BakeProgressListener,
  type Font,
  type RasterFormatInput,
  type RasterFormatMetadata,
  type RasterFormatRequest,
} from '@pmndrs/glyph';

import type { FontDelivery } from '../../benchmark/url-state';
import type { BenchmarkFontFixture } from '../../benchmark/font-fixtures';
import type { FontDeliveryMetrics } from './contracts';
import { benchmarkFontLibrary, type RuntimeFontBake, type RuntimeFontBakeRequest } from './library';

import amiriSourceUrl from '../../../fixtures/fonts/amiri-1.002/Amiri-Regular.ttf?url';
import dancingScriptSourceUrl from '../../../fixtures/fonts/dancing-script-3.000/DancingScript-Regular.otf?url';
import dotGothicSourceUrl from '../../../fixtures/fonts/dot-gothic-16/DotGothic16-Regular.ttf?url';
import fontAwesomeSourceUrl from '../../../fixtures/fonts/font-awesome-free-6.7.2/fa-solid-900.ttf?url';
import interSourceUrl from '../../../fixtures/fonts/inter-v4.1/Inter-Regular.ttf?url';
import notoCjkSourceUrl from '../../../fixtures/fonts/noto-sans-cjk-showcase-v0/NotoSansCJKjp-Showcase.otf?url';
import devanagariSourceUrl from '../../../fixtures/fonts/noto-sans-devanagari/NotoSansDevanagari.ttf?url';
import sourceSerifSourceUrl from '../../../fixtures/fonts/source-serif-4.005/SourceSerif4-Regular.ttf?url';

const sourceUrls: Readonly<Record<BenchmarkFontFixture, string>> = {
  inter: interSourceUrl,
  amiri: amiriSourceUrl,
  'noto-sans-devanagari': devanagariSourceUrl,
  'noto-sans-cjk-showcase': notoCjkSourceUrl,
  'dot-gothic-16': dotGothicSourceUrl,
  'font-awesome-free-6.7.2': fontAwesomeSourceUrl,
  'source-serif-4': sourceSerifSourceUrl,
  'dancing-script': dancingScriptSourceUrl,
};

const retainedBakedPreloads = new Map<string, Promise<Font<RasterFormatMetadata>>>();

if (import.meta.hot !== undefined) {
  import.meta.hot.dispose(() => {
    void disposeBakedFontPreloads();
  });
}

export function sourceUrlForFixture(fixture: BenchmarkFontFixture): string {
  return sourceUrls[fixture];
}

export function createFontDeliveryMetrics(delivery: FontDelivery): FontDeliveryMetrics {
  return {
    delivery,
    sourceFontBytes: 0,
    coreArtifactBytes: 0,
    coreBakeMs: 0,
    rasterArtifactBytes: 0,
    rasterBakeMs: 0,
    rasterGpuBytes: 0,
  };
}

/** Records source size, duration, and artifact size of one core bake; per-load so concurrent loads (e.g. label vs icon) attribute to separate metrics. */
export function measuredRuntimeFontBake(
  metrics: FontDeliveryMetrics,
  onProgress?: BakeProgressListener,
): RuntimeFontBake {
  return async (request: RuntimeFontBakeRequest) => {
    metrics.sourceFontBytes = request.source.byteLength;
    const started = performance.now();
    const { bakeFontInWorker } = await import('@pmndrs/glyph/runtime-bake');
    const artifact = await bakeFontInWorker({
      ...request,
      ...(onProgress === undefined ? {} : { onProgress }),
    });
    metrics.coreBakeMs = performance.now() - started;
    metrics.coreArtifactBytes = artifact.byteLength;
    return artifact;
  };
}

/** Loads one font from artifact bytes the caller already fetched and authenticated. */
export async function loadBakedFont<Format extends RasterFormatMetadata>({
  artifact,
  raster,
  signal,
}: {
  readonly artifact: string;
  readonly raster: RasterFormatInput<Format>;
  readonly signal?: AbortSignal | undefined;
}): Promise<Font<Format>> {
  return loadThroughBenchmarkLibrary({ baked: artifact }, raster, signal);
}

/** Keeps one application-lifetime owner for a baked fixture; short-lived scenes still acquire/dispose their own leases, while this owner keeps the decoded source and raster variant warm across technique switches. */
export async function preloadBakedFont<Format extends RasterFormatMetadata>({
  artifact,
  raster,
  signal,
}: {
  readonly artifact: string;
  readonly raster: RasterFormatRequest<Format>;
  readonly signal?: AbortSignal | undefined;
}): Promise<void> {
  const key = retainedBakedPreloadKey(artifact, raster);
  let retained = retainedBakedPreloads.get(key);
  if (retained === undefined) {
    const pending = loadBakedFont({ artifact, raster, signal });
    retained = pending;
    retainedBakedPreloads.set(key, pending);
    void pending.catch(() => {
      if (retainedBakedPreloads.get(key) === pending) retainedBakedPreloads.delete(key);
    });
  }
  await retained;
}

/** Releases the benchmark application's retained preload owners. Scene-owned Font leases remain independently valid. */
export async function disposeBakedFontPreloads(): Promise<void> {
  const retained = [...retainedBakedPreloads.values()];
  retainedBakedPreloads.clear();
  const results = await Promise.allSettled(retained);
  for (const result of results) if (result.status === 'fulfilled') result.value.dispose();
}

function retainedBakedPreloadKey<Format extends RasterFormatMetadata>(
  artifact: string,
  input: RasterFormatRequest<Format>,
): string {
  return `${artifact}\u0000${input.raster.id}\u0000${JSON.stringify(input.options ?? null)}`;
}

/** Loads one font from its source URL, baking the core artifact and the selected raster through the measured bakers. */
export function loadSourceFont<Format extends RasterFormatMetadata>({
  source,
  raster,
  runtimeBake,
  signal,
}: {
  readonly source: string;
  readonly raster: RasterFormatInput<Format>;
  readonly runtimeBake: RuntimeFontBake;
  readonly signal?: AbortSignal | undefined;
}): Promise<Font<Format>> {
  return loadThroughBenchmarkLibrary({ source, runtimeBake }, raster, signal);
}

function loadThroughBenchmarkLibrary<Format extends RasterFormatMetadata>(
  input: Parameters<typeof benchmarkFontLibrary.loadFont>[0],
  raster: RasterFormatInput<Format>,
  signal: AbortSignal | undefined,
): Promise<Font<Format>> {
  const options = signal === undefined ? {} : { signal };
  return benchmarkFontLibrary.loadFont(input, raster, options);
}
