import {
  FontLoader,
  FontRegistry,
  type BakeProgressListener,
  type RasterBakeArtifact,
  type RuntimeFontBakeRequest,
  type RuntimeRasterBakerModule,
} from '@pmndrs/text';

import type { FontDelivery } from '../../benchmark/url-state';
import type { BenchmarkFontFixture } from '../../benchmark/font-fixtures';
import type { FontDeliveryMetrics } from './contracts';

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

/** Uses the published FontLoader and runtime-bake entrypoint; no Wasm URL is imported by benchmark scenes. */
export async function loadRuntimeCoreFont({
  source,
  metrics,
  registry,
  signal,
  onProgress,
}: {
  readonly source: string;
  readonly metrics: FontDeliveryMetrics;
  readonly registry: FontRegistry;
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: BakeProgressListener | undefined;
}) {
  const loader = new FontLoader({
    registry,
    runtimeBake: async (request: RuntimeFontBakeRequest) => {
      metrics.sourceFontBytes = request.source.byteLength;
      const started = performance.now();
      const { bakeFontInWorker } = await import('@pmndrs/text/runtime-bake');
      const artifact = await bakeFontInWorker({
        ...request,
        ...(onProgress === undefined ? {} : { onProgress }),
      });
      metrics.coreBakeMs = performance.now() - started;
      metrics.coreArtifactBytes = artifact.byteLength;
      return artifact;
    },
  });
  return loader.load({ source, baked: null }, signal === undefined ? undefined : { signal });
}

export function measuredRuntimeRaster<Kind extends string, Options>(
  load:
    | (() => Promise<
        RuntimeRasterBakerModule<Kind, Options> | { readonly default: RuntimeRasterBakerModule<Kind, Options> }
      >)
    | undefined,
  metrics: FontDeliveryMetrics,
  onProgress?: BakeProgressListener,
) {
  if (load === undefined) return undefined;
  return async (): Promise<RuntimeRasterBakerModule<Kind, Options>> => {
    const started = performance.now();
    const imported = await load();
    const baker = isDefaultRasterBaker<Kind, Options>(imported) ? imported.default : imported;
    if (!isRuntimeRasterBaker<Kind, Options>(baker)) throw new TypeError('runtime raster baker module is invalid');
    return {
      kind: baker.kind,
      async bake(request) {
        const artifact = await baker.bake({ ...request, ...(onProgress === undefined ? {} : { onProgress }) });
        metrics.rasterBakeMs = performance.now() - started;
        metrics.rasterArtifactBytes = rasterArtifactBytes(artifact);
        metrics.rasterGpuBytes = artifact.report.gpuBytes;
        return artifact;
      },
    };
  };
}

function isDefaultRasterBaker<Kind extends string, Options>(
  value: unknown,
): value is { readonly default: RuntimeRasterBakerModule<Kind, Options> } {
  return typeof value === 'object' && value !== null && 'default' in value;
}

function isRuntimeRasterBaker<Kind extends string, Options>(
  value: unknown,
): value is RuntimeRasterBakerModule<Kind, Options> {
  return typeof value === 'object' && value !== null && 'kind' in value && 'bake' in value;
}

function rasterArtifactBytes(artifact: RasterBakeArtifact<string>): number {
  return artifact.artifacts.reduce((total, entry) => total + entry.bytes.byteLength, 0);
}
