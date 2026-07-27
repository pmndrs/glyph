import {
  FontLoader,
  FontRegistry,
  defineRaster,
  type RasterBakeArtifact,
  type RegisteredFont,
  type RuntimeFontBakeRequest,
  type RuntimeRasterBakerModule,
} from '@pmndrs/text'
import { bitmap, type BitmapModule } from '@pmndrs/text/raster/bitmap'
import { msdf, type MsdfModule } from '@pmndrs/text/raster/msdf'

import amiriSourceUrl from '../../fixtures/fonts/amiri-1.002/Amiri-Regular.ttf?url'
import dancingScriptSourceUrl from '../../fixtures/fonts/dancing-script-3.000/DancingScript-Regular.otf?url'
import dotGothicSourceUrl from '../../fixtures/fonts/dot-gothic-16/DotGothic16-Regular.ttf?url'
import interSourceUrl from '../../fixtures/fonts/inter-v4.1/Inter-Regular.ttf?url'
import notoCjkSourceUrl from '../../fixtures/fonts/noto-sans-cjk-showcase-v0/NotoSansCJKjp-Showcase.otf?url'
import devanagariSourceUrl from '../../fixtures/fonts/noto-sans-devanagari/NotoSansDevanagari.ttf?url'
import sourceSerifSourceUrl from '../../fixtures/fonts/source-serif-4.005/SourceSerif4-Regular.ttf?url'
import type { BenchmarkFontFixture } from '../benchmark/font-fixtures'
import type { FontDelivery } from '../benchmark/url-state'

const sourceUrls: Readonly<Record<BenchmarkFontFixture, string>> = {
  inter: interSourceUrl,
  amiri: amiriSourceUrl,
  'noto-sans-devanagari': devanagariSourceUrl,
  'noto-sans-cjk-showcase': notoCjkSourceUrl,
  'dot-gothic-16': dotGothicSourceUrl,
  'source-serif-4': sourceSerifSourceUrl,
  'dancing-script': dancingScriptSourceUrl,
}

export interface FontDeliveryMetrics {
  readonly delivery: FontDelivery
  sourceFontBytes: number
  coreArtifactBytes: number
  coreBakeMs: number
  rasterArtifactBytes: number
  rasterBakeMs: number
  rasterGpuBytes: number
}

export interface RuntimeLoadedFont {
  readonly font: RegisteredFont
  readonly metrics: FontDeliveryMetrics
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
  }
}

export async function loadRuntimeFont(
  fixture: BenchmarkFontFixture,
  metrics: FontDeliveryMetrics,
  signal?: AbortSignal,
): Promise<RuntimeLoadedFont> {
  const registry = new FontRegistry()
  const loader = new FontLoader({
    registry,
    runtimeBake: async (request: RuntimeFontBakeRequest) => {
      metrics.sourceFontBytes = request.source.byteLength
      const started = performance.now()
      const { bakeFontInWorker } = await import('@pmndrs/text/runtime-bake')
      const artifact = await bakeFontInWorker(request)
      metrics.coreBakeMs = performance.now() - started
      metrics.coreArtifactBytes = artifact.byteLength
      return artifact
    },
  })
  return {
    font: await loader.load(
      { source: sourceUrls[fixture], baked: null },
      signal === undefined ? undefined : { signal },
    ),
    metrics,
  }
}

export function measuredBitmapRaster(metrics: FontDeliveryMetrics) {
  const base = bitmap({ strikes: [16] as const })
  const runtimeBaker = measuredRuntimeBaker(base.module.runtimeBaker, metrics)
  const module: BitmapModule = defineRaster({
    ...base.module,
    ...(runtimeBaker === undefined ? {} : { runtimeBaker }),
  })
  return { module, options: base.options }
}

export function measuredMsdfRaster(metrics: FontDeliveryMetrics): MsdfModule {
  const runtimeBaker = measuredRuntimeBaker(msdf.runtimeBaker, metrics)
  return defineRaster({
    ...msdf,
    ...(runtimeBaker === undefined ? {} : { runtimeBaker }),
  })
}

function measuredRuntimeBaker<Kind extends string, Options>(
  load:
    | (() => Promise<
        | RuntimeRasterBakerModule<Kind, Options>
        | { readonly default: RuntimeRasterBakerModule<Kind, Options> }
      >)
    | undefined,
  metrics: FontDeliveryMetrics,
) {
  if (load === undefined) return undefined
  return async (): Promise<RuntimeRasterBakerModule<Kind, Options>> => {
    const started = performance.now()
    const imported = await load()
    const baker = 'default' in imported ? imported.default : imported
    return {
      kind: baker.kind,
      async bake(request) {
        const artifact = await baker.bake(request)
        metrics.rasterBakeMs = performance.now() - started
        metrics.rasterArtifactBytes = rasterArtifactBytes(artifact)
        metrics.rasterGpuBytes = artifact.report.gpuBytes
        return artifact
      },
    }
  }
}

function rasterArtifactBytes(artifact: RasterBakeArtifact<string>): number {
  return artifact.artifacts.reduce((total, entry) => total + entry.bytes.byteLength, 0)
}
