import type { SelectableFontFixture } from '../../benchmark/font-fixtures';
import type { MtsdfTextConformanceCapture } from '../../benchmark/targets/conformance/raster/mtsdf-capture';
import type { SlugTextConformanceCapture } from '../../benchmark/targets/conformance/raster/slug-capture';
import type { ConformanceWorkloadId } from '../../benchmark/workloads';
import type { GraphicsBackend, RasterTechnique } from '../../benchmark/url-state';
import type { BitmapTextConformanceCapture } from '../../benchmark/low-level/raster/bitmap-finite-scene';
import type { PersistentRenderSceneRenderer } from '../../renderer/persistent-render-host';
import type { SourceOutlineFidelityCapture } from '../../benchmark/low-level/raster/source-outline-reference';
import type { RuntimeFallbackCapture } from '../../benchmark/targets/conformance/raster/runtime-fallback';

export type FiniteConformanceCapture =
  | { readonly kind: 'bitmap'; readonly value: BitmapTextConformanceCapture }
  | { readonly kind: 'mtsdf'; readonly value: MtsdfTextConformanceCapture }
  | { readonly kind: 'slug'; readonly value: SlugTextConformanceCapture }
  | { readonly kind: 'source-outline'; readonly value: SourceOutlineFidelityCapture }
  | { readonly kind: 'runtime-fallback'; readonly value: RuntimeFallbackCapture };

interface FiniteConformanceCaptureOptions {
  readonly backend: GraphicsBackend;
  readonly dpr: 1 | 2;
  readonly fontFixture: SelectableFontFixture;
  readonly renderer: PersistentRenderSceneRenderer;
  readonly signal: AbortSignal;
  readonly technique: RasterTechnique;
  readonly workload: ConformanceWorkloadId;
}

function loadBitmapTextRenderer() {
  return import('../../renderer/bitmap-text');
}

function loadMtsdfCapture() {
  return import('../../benchmark/targets/conformance/raster/mtsdf-capture');
}

function loadSlugCapture() {
  return import('../../benchmark/targets/conformance/raster/slug-capture');
}

function loadRuntimeFallbackConformance() {
  return import('../../benchmark/targets/conformance/raster/runtime-fallback');
}

/** Captures through the caller-provided persistent host renderer; this module never owns a second renderer. */
export async function captureFiniteConformance({
  backend,
  dpr,
  fontFixture,
  renderer,
  signal,
  technique,
  workload,
}: FiniteConformanceCaptureOptions): Promise<FiniteConformanceCapture> {
  if (workload === 'runtime-fallback') {
    const { captureRuntimeFallbackConformance } = await loadRuntimeFallbackConformance();
    return {
      kind: 'runtime-fallback',
      value: await captureRuntimeFallbackConformance({ backend, dpr, fontFixture, renderer, signal, technique }),
    };
  }
  if (workload === 'cross-technique-fidelity') {
    if (technique === 'slug') {
      const { captureSlugSourceOutlineFidelity } = await loadSlugCapture();
      return {
        kind: 'source-outline',
        value: await captureSlugSourceOutlineFidelity({ backend, dpr, fontFixture, renderer, signal }),
      };
    }
    if (technique === 'mtsdf') {
      const { captureMtsdfSourceOutlineFidelity } = await loadMtsdfCapture();
      return {
        kind: 'source-outline',
        value: await captureMtsdfSourceOutlineFidelity({ backend, dpr, fontFixture, renderer, signal }),
      };
    }
    const { captureBitmapSourceOutlineFidelity } = await loadBitmapTextRenderer();
    return {
      kind: 'source-outline',
      value: await captureBitmapSourceOutlineFidelity({ backend, dpr, fontFixture, renderer, signal }),
    };
  }
  if (technique === 'slug') {
    const { captureSlugTextConformance } = await loadSlugCapture();
    return {
      kind: 'slug',
      value: await captureSlugTextConformance({ backend, dpr, fontFixture, renderer, signal }),
    };
  }
  if (technique === 'mtsdf') {
    const { captureMtsdfTextConformance } = await loadMtsdfCapture();
    return {
      kind: 'mtsdf',
      value: await captureMtsdfTextConformance({ backend, dpr, fontFixture, renderer, signal }),
    };
  }
  const { captureBitmapTextConformance } = await loadBitmapTextRenderer();
  return {
    kind: 'bitmap',
    value: await captureBitmapTextConformance({ backend, dpr, fontFixture, renderer, signal }),
  };
}
