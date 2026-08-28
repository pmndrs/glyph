import {
  type AnyRasterTechnique,
  type BakeProgressListener,
  defineRasterTechnique,
  type FontLibrary,
  type Font,
  type FontRequest,
  type JsonValue,
  type RasterTechnique,
  type RasterTechniqueId,
  type RasterOptionsArgument,
  type RasterBakeArtifact,
  type RuntimeFontBake,
  type RuntimeFontBakeRequest,
  type RuntimeRasterBakerModule,
} from '@pmndrs/glyph';
import { FontLoader } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';

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

/**
 * Records the source size, duration, and artifact size of one core bake. The baker is per load because its measurements
 * belong to one asset; a loader-wide baker could not attribute concurrent label and icon loads to separate metrics.
 */
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

/**
 * The Three font loader keys one text runtime per loading manager, and every `Text` in a paragraph batch must share a
 * runtime. A caller-supplied immutable library gives an isolated benchmark surface one manager and loader domain.
 */
const sharedLoadingManager = new THREE.LoadingManager();
const isolatedLoadingManagers = new WeakMap<FontLibrary, THREE.LoadingManager>();
const fontLoaders = new WeakMap<THREE.LoadingManager, FontLoader>();

/**
 * Loads one font from artifact bytes the caller already fetched and authenticated. `LoadedFontInput` accepts URLs
 * rather than bytes, so the authenticated artifact is published as a blob URL that is revoked once the load settles.
 */
export async function loadBakedFont<Technique extends AnyRasterTechnique>({
  artifact,
  raster,
  library,
  signal,
}: {
  readonly artifact: Uint8Array<ArrayBuffer>;
  readonly raster: FontRequest<Technique>['raster'];
  readonly library?: FontLibrary | undefined;
  readonly signal?: AbortSignal | undefined;
}): Promise<Font<Technique>> {
  const url = URL.createObjectURL(new Blob([artifact], { type: 'model/gltf-binary' }));
  try {
    return await fontLoader(library).loadAsync({
      input: { baked: url },
      raster,
      ...(signal === undefined ? {} : { signal }),
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Loads one font from its source URL, baking the core artifact and the selected raster through the measured bakers. */
export function loadSourceFont<Technique extends AnyRasterTechnique>({
  source,
  raster,
  runtimeBake,
  library,
  signal,
}: {
  readonly source: string;
  readonly raster: FontRequest<Technique>['raster'];
  readonly runtimeBake: RuntimeFontBake;
  readonly library?: FontLibrary | undefined;
  readonly signal?: AbortSignal | undefined;
}): Promise<Font<Technique>> {
  return fontLoader(library).loadAsync({
    input: { source, runtimeBake },
    raster,
    ...(signal === undefined ? {} : { signal }),
  });
}

function fontLoader(library: FontLibrary | undefined): FontLoader {
  const manager = loadingManager(library);
  let loader = fontLoaders.get(manager);
  if (loader === undefined) {
    loader = new FontLoader(manager, library === undefined ? {} : { library });
    fontLoaders.set(manager, loader);
  }
  return loader;
}

function loadingManager(library: FontLibrary | undefined): THREE.LoadingManager {
  if (library === undefined) return sharedLoadingManager;
  let manager = isolatedLoadingManagers.get(library);
  if (manager === undefined) {
    manager = new THREE.LoadingManager();
    isolatedLoadingManagers.set(library, manager);
  }
  return manager;
}

/** Capture data decoded by a benchmark-owned technique wrapper without exposing it through Font. */
export function captureRasterTechniqueData<
  Id extends RasterTechniqueId,
  Kind extends string,
  Options,
  Descriptor extends JsonValue,
  Data,
>(
  technique: RasterTechnique<Id, Kind, Options, Descriptor, Data>,
  beforeDecode?: (
    font: Parameters<RasterTechnique<Id, Kind, Options, Descriptor, Data>['decode']>[0],
    raster: Parameters<RasterTechnique<Id, Kind, Options, Descriptor, Data>['decode']>[1],
  ) => void,
) {
  let decoded: Data | undefined;
  const captured = defineRasterTechnique({
    id: technique.id,
    kind: technique.kind,
    extension: technique.extension,
    version: technique.version,
    ...(technique.runtimeBaker === undefined ? {} : { runtimeBaker: technique.runtimeBaker }),
    descriptor: (options: RasterOptionsArgument<Options>) => technique.descriptor(options),
    async decode(font, raster, signal) {
      beforeDecode?.(font, raster);
      const data = await technique.decode(font, raster, signal);
      decoded = data;
      return data;
    },
    dispose: (data: Data) => technique.dispose(data),
  });
  return Object.freeze({
    technique: captured,
    data(): Data {
      if (decoded === undefined) throw new Error('benchmark raster technique has not decoded a font');
      return decoded;
    },
  });
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
