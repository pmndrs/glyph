import type { BenchmarkInput, BenchmarkTarget, Capability } from '../../contracts';
import { selectableFontFixture } from '../../font-fixtures';
import { createFontLoaderWorkerConformanceTarget } from './font-loader-worker';
import { createParagraphContractsConformanceTarget } from './paragraph-contracts';
import { mtsdfRasterConformanceAdapter } from './raster/mtsdf';
import { slugRasterConformanceAdapter } from './raster/slug';
import { createRasterSamplingConformanceTarget, createRasterSourceOutlineConformanceTarget } from './raster/target';
import { createDeferredTarget, sha256 } from '../shared';

type Backend = 'webgpu' | 'webgl2';
type RasterFormatName = 'bitmap' | 'mtsdf' | 'slug';

const rasterCapabilities: ReadonlySet<Capability> = new Set([
  'deterministic',
  'font-bytes',
  'wasm',
  'shaping',
  'paragraph',
  'raster',
]);
const backendColor = (backend: Backend): 'cyan' | 'amber' => (backend === 'webgpu' ? 'cyan' : 'amber');
const backendLabel = (backend: Backend): 'WebGPU' | 'WebGL' => (backend === 'webgpu' ? 'WebGPU' : 'WebGL');
const formatLabel = (format: RasterFormatName): 'Bitmap' | 'MSDF' | 'Slug' =>
  format === 'mtsdf' ? 'MSDF' : format === 'slug' ? 'Slug' : 'Bitmap';

function tslBaselineTarget(backend: Backend): BenchmarkTarget {
  return createDeferredTarget(
    {
      id: `tsl-${backend}-baseline`,
      label: `TSL ${backendLabel(backend)} baseline`,
      detail: 'WebGPURenderer · TSL · deterministic readback',
      color: backendColor(backend),
      capabilities: new Set<Capability>(['deterministic', 'raster']),
      status: () => 'ready',
    },
    async () => (await import('./tsl-baseline')).createTslBaselineTarget(backend),
  );
}

function samplingTarget(format: Extract<RasterFormatName, 'mtsdf' | 'slug'>, backend: Backend): BenchmarkTarget {
  return createRasterSamplingConformanceTarget(
    format === 'mtsdf' ? mtsdfRasterConformanceAdapter : slugRasterConformanceAdapter,
    backend,
  );
}

const advancedShapingTarget = () =>
  createDeferredTarget(
    {
      id: 'advanced-shaping-conformance',
      label: 'Advanced shaping conformance',
      detail: 'five scripts · every authored frame · public Text bitmap batches',
      color: 'violet',
      capabilities: rasterCapabilities,
      status: () => 'ready',
    },
    async () => (await import('./advanced-shaping')).createAdvancedShapingConformanceTarget(),
  );

const richTextSpansTarget = () =>
  createDeferredTarget(
    {
      id: 'rich-text-spans-conformance',
      label: 'Rich text span conformance',
      detail: 'features · tracking · size · face · fallback · nested paint · public Text bitmap batches',
      color: 'violet',
      capabilities: rasterCapabilities,
      status: () => 'ready',
    },
    async () => (await import('./rich-text-spans')).createRichTextSpansConformanceTarget(),
  );

function sourceOutlineFidelityTarget(format: RasterFormatName, backend: Backend): BenchmarkTarget {
  if (format === 'mtsdf' || format === 'slug') {
    return createRasterSourceOutlineConformanceTarget(
      format === 'mtsdf' ? mtsdfRasterConformanceAdapter : slugRasterConformanceAdapter,
      backend,
    );
  }
  let configuredInput: BenchmarkInput = {};
  return {
    id: `source-outline-${format}-${backend}`,
    label: `${formatLabel(format)} source-outline fidelity · ${backendLabel(backend)}`,
    detail: 'GPU candidate · pinned source font · browser Canvas2D reference',
    color: backendColor(backend),
    capabilities: rasterCapabilities,
    configure: (input) => {
      configuredInput = input;
    },
    status: () => 'ready',
    load: async () => undefined,
    run: async (input, _sampleIndex, controls, context) => {
      const fontFixture = input.fontFixture ?? configuredInput.fontFixture ?? 'inter';
      const capture = await import('./raster/bitmap-capture').then(({ captureBitmapSourceOutlineFidelity }) =>
        captureBitmapSourceOutlineFidelity({
          backend,
          dpr: controls.dpr,
          fontFixture: selectableFontFixture(fontFixture),
          ...(context?.renderer === undefined ? {} : { renderer: context.renderer }),
          ...(context?.signal === undefined ? {} : { signal: context.signal }),
        }),
      );
      return {
        bytes: capture.candidate.byteLength,
        hash: await sha256(capture.candidate),
        metrics: {
          techniqueBitmap: format === 'bitmap' ? 1 : 0,
          techniqueMtsdf: 0,
          techniqueSlug: 0,
          fixtureIsDotGothic: fontFixture === 'dot-gothic-16' ? 1 : 0,
          backendWebGpu: backend === 'webgpu' ? 1 : 0,
          backendWebGl2: backend === 'webgl2' ? 1 : 0,
          dpr: controls.dpr,
          pixelCount: capture.width * capture.height,
          physicalPpem: capture.physicalPpem,
          meanAbsoluteError: capture.meanAbsoluteError,
          maximumError: capture.maximumError,
          errorPixels: capture.errorPixels,
          renderMs: capture.renderSubmitMs,
        },
      };
    },
    dispose: async () => undefined,
  };
}

function runtimeFallbackTarget(format: RasterFormatName, backend: Backend): BenchmarkTarget {
  let configuredInput: BenchmarkInput = {};
  return {
    id: `runtime-fallback-${format}-${backend}`,
    label: `${formatLabel(format)} runtime fallback · ${backendLabel(backend)}`,
    detail: 'checked-in baked frame · source-font Worker bake · exact comparison',
    color: backendColor(backend),
    capabilities: rasterCapabilities,
    configure: (input) => {
      configuredInput = input;
    },
    status: () => 'ready',
    load: async () => undefined,
    run: async (input, _sampleIndex, controls, context) => {
      const fontFixture = selectableFontFixture(input.fontFixture ?? configuredInput.fontFixture ?? 'inter');
      const { captureRuntimeFallbackConformance } = await import('./raster/runtime-fallback');
      const capture = await captureRuntimeFallbackConformance({
        backend,
        dpr: controls.dpr,
        fontFixture,
        ...(context?.renderer === undefined ? {} : { renderer: context.renderer }),
        ...(context?.signal === undefined ? {} : { signal: context.signal }),
        technique: format,
      });
      return {
        bytes: capture.runtime.byteLength,
        hash: await sha256(capture.runtime),
        metrics: {
          mismatchBytes: capture.mismatchBytes,
          changedPixels: capture.changedPixels,
          maximumError: capture.maximumError,
          renderMs: capture.renderSubmitMs,
        },
      };
    },
    dispose: async () => undefined,
  };
}

export function createConformanceTargets(): readonly BenchmarkTarget[] {
  return [
    createFontLoaderWorkerConformanceTarget(),
    createParagraphContractsConformanceTarget(),
    tslBaselineTarget('webgl2'),
    tslBaselineTarget('webgpu'),
    advancedShapingTarget(),
    richTextSpansTarget(),
    samplingTarget('mtsdf', 'webgl2'),
    samplingTarget('mtsdf', 'webgpu'),
    samplingTarget('slug', 'webgl2'),
    samplingTarget('slug', 'webgpu'),
    ...(['bitmap', 'mtsdf', 'slug'] as const).flatMap((format) => [
      sourceOutlineFidelityTarget(format, 'webgl2'),
      sourceOutlineFidelityTarget(format, 'webgpu'),
      runtimeFallbackTarget(format, 'webgl2'),
      runtimeFallbackTarget(format, 'webgpu'),
    ]),
  ];
}
