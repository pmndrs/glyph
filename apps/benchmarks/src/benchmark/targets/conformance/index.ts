import type { BenchmarkInput, BenchmarkTarget, Capability } from '../../contracts';
import { selectableFontFixture } from '../../font-fixtures';
import { createShapingConformanceTargets } from './direct-runtime';
import { createFontLoaderWorkerConformanceTarget } from './font-loader-worker';
import { createDeferredTarget, sha256 } from '../shared';

type Backend = 'webgpu' | 'webgl2';
type Technique = 'bitmap' | 'mtsdf' | 'slug';

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
const techniqueLabel = (technique: Technique): 'Bitmap' | 'MSDF' | 'Slug' =>
  technique === 'mtsdf' ? 'MSDF' : technique === 'slug' ? 'Slug' : 'Bitmap';

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
    async () => (await import('../../../renderer/tsl-baseline')).createTslBaselineTarget(backend),
  );
}

function samplingTarget(technique: Extract<Technique, 'mtsdf' | 'slug'>, backend: Backend): BenchmarkTarget {
  return createDeferredTarget(
    {
      id: `${technique}-conformance-${backend}`,
      label: `${technique === 'mtsdf' ? 'MTSDF' : 'Slug'} sampling conformance · ${backendLabel(backend)}`,
      detail: 'GPU TSL candidate · independent scalar CPU reconstruction',
      color: technique === 'slug' && backend === 'webgpu' ? 'green' : backendColor(backend),
      capabilities: rasterCapabilities,
      status: () => 'ready',
    },
    async () => {
      if (technique === 'mtsdf')
        return (await import('../../../renderer/mtsdf-text')).createMtsdfConformanceTarget(backend);
      return (await import('../../../renderer/slug-text')).createSlugConformanceTarget(backend);
    },
    { forwardsConfiguration: true },
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

function sourceOutlineFidelityTarget(technique: Technique, backend: Backend): BenchmarkTarget {
  let configuredInput: BenchmarkInput = {};
  return {
    id: `source-outline-${technique}-${backend}`,
    label: `${techniqueLabel(technique)} source-outline fidelity · ${backendLabel(backend)}`,
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
      const capture =
        technique === 'slug'
          ? await import('../../../renderer/slug-text').then(({ captureSlugSourceOutlineFidelity }) =>
              captureSlugSourceOutlineFidelity({
                backend,
                dpr: controls.dpr,
                fontFixture,
                ...(context?.renderer === undefined ? {} : { renderer: context.renderer }),
                ...(context?.signal === undefined ? {} : { signal: context.signal }),
              }),
            )
          : technique === 'mtsdf'
            ? await import('../../../renderer/mtsdf-text').then(({ captureMtsdfSourceOutlineFidelity }) =>
                captureMtsdfSourceOutlineFidelity({
                  backend,
                  dpr: controls.dpr,
                  fontFixture: selectableFontFixture(fontFixture),
                  ...(context?.renderer === undefined ? {} : { renderer: context.renderer }),
                  ...(context?.signal === undefined ? {} : { signal: context.signal }),
                }),
              )
            : await import('../../../renderer/bitmap-text').then(({ captureBitmapSourceOutlineFidelity }) =>
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
          techniqueBitmap: technique === 'bitmap' ? 1 : 0,
          techniqueMtsdf: technique === 'mtsdf' ? 1 : 0,
          techniqueSlug: technique === 'slug' ? 1 : 0,
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

function runtimeFallbackTarget(technique: Technique, backend: Backend): BenchmarkTarget {
  let configuredInput: BenchmarkInput = {};
  return {
    id: `runtime-fallback-${technique}-${backend}`,
    label: `${techniqueLabel(technique)} runtime fallback · ${backendLabel(backend)}`,
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
      const { captureRuntimeFallbackConformance } = await import('../../../renderer/runtime-fallback-conformance');
      const capture = await captureRuntimeFallbackConformance({
        backend,
        dpr: controls.dpr,
        fontFixture,
        ...(context?.renderer === undefined ? {} : { renderer: context.renderer }),
        ...(context?.signal === undefined ? {} : { signal: context.signal }),
        technique,
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
    ...createShapingConformanceTargets(),
    tslBaselineTarget('webgl2'),
    tslBaselineTarget('webgpu'),
    advancedShapingTarget(),
    samplingTarget('mtsdf', 'webgl2'),
    samplingTarget('mtsdf', 'webgpu'),
    samplingTarget('slug', 'webgl2'),
    samplingTarget('slug', 'webgpu'),
    ...(['bitmap', 'mtsdf', 'slug'] as const).flatMap((technique) => [
      sourceOutlineFidelityTarget(technique, 'webgl2'),
      sourceOutlineFidelityTarget(technique, 'webgpu'),
      runtimeFallbackTarget(technique, 'webgl2'),
      runtimeFallbackTarget(technique, 'webgpu'),
    ]),
  ];
}
