import type { BenchmarkExecutionContext, BenchmarkInput, BenchmarkTarget, Capability } from '../../../contracts';
import { sha256 } from '../../shared';
import type {
  RasterConformanceAdapter,
  RasterConformanceBackend,
  RasterConformanceSession,
  RasterConformanceTechnique,
} from './contracts';

const rasterCapabilities: ReadonlySet<Capability> = new Set([
  'deterministic',
  'font-bytes',
  'wasm',
  'shaping',
  'paragraph',
  'raster',
]);

const backendColor = (backend: RasterConformanceBackend): 'cyan' | 'amber' => (backend === 'webgpu' ? 'cyan' : 'amber');
const backendLabel = (backend: RasterConformanceBackend): 'WebGPU' | 'WebGL' =>
  backend === 'webgpu' ? 'WebGPU' : 'WebGL';
const techniqueLabel = (technique: RasterConformanceTechnique): 'MTSDF' | 'Slug' =>
  technique === 'mtsdf' ? 'MTSDF' : 'Slug';

interface RasterTargetSession {
  get(context?: BenchmarkExecutionContext): Promise<RasterConformanceSession>;
  loaded(): RasterConformanceSession | undefined;
  dispose(): Promise<void>;
}

function createRasterTargetSession(
  adapter: RasterConformanceAdapter,
  backend: RasterConformanceBackend,
): RasterTargetSession {
  let session: RasterConformanceSession | undefined;
  let creation: Promise<RasterConformanceSession> | undefined;
  let lifecycleVersion = 0;

  const get = async (context?: BenchmarkExecutionContext): Promise<RasterConformanceSession> => {
    context?.signal?.throwIfAborted();
    if (session !== undefined) return session;
    const requestedVersion = lifecycleVersion;
    const pending = (creation ??= adapter.createSession(backend).then(
      (created) => {
        session = created;
        return created;
      },
      (error: unknown) => {
        creation = undefined;
        throw error;
      },
    ));
    const created = await pending;
    if (requestedVersion !== lifecycleVersion) {
      throw new DOMException('Raster conformance session was disposed during creation', 'AbortError');
    }
    context?.signal?.throwIfAborted();
    return created;
  };

  return {
    get,
    loaded: () => session,
    dispose: async () => {
      lifecycleVersion += 1;
      const pending = creation;
      if (pending !== undefined) {
        try {
          await pending;
        } catch {
          // The caller that started session creation receives its failure. Disposal only releases a created session.
        }
      }
      const current = session;
      session = undefined;
      creation = undefined;
      if (current !== undefined) await current.dispose();
    },
  };
}

export function createRasterSamplingConformanceTarget(
  adapter: RasterConformanceAdapter,
  backend: RasterConformanceBackend,
): BenchmarkTarget {
  const session = createRasterTargetSession(adapter, backend);
  let configuredInput: BenchmarkInput = {};
  const technique = adapter.technique;
  return {
    id: `${technique}-conformance-${backend}`,
    label: `${techniqueLabel(technique)} sampling conformance · ${backendLabel(backend)}`,
    detail: 'GPU TSL candidate · independent scalar CPU reconstruction · visual difference',
    color: technique === 'slug' && backend === 'webgpu' ? 'green' : backendColor(backend),
    capabilities: rasterCapabilities,
    configure: (input) => {
      configuredInput = input;
    },
    status: () => 'ready',
    load: async (controls, context) => {
      const current = await session.get(context);
      await current.load(configuredInput, controls, context);
      context?.signal?.throwIfAborted();
    },
    run: async (input, sampleIndex, controls, context) => {
      context?.signal?.throwIfAborted();
      const current = session.loaded();
      if (current === undefined) throw new Error(`${techniqueLabel(technique)} conformance target was not loaded`);
      return current.captureSampling(input, sampleIndex, controls, context);
    },
    dispose: session.dispose,
  };
}

export function createRasterSourceOutlineConformanceTarget(
  adapter: RasterConformanceAdapter,
  backend: RasterConformanceBackend,
): BenchmarkTarget {
  const session = createRasterTargetSession(adapter, backend);
  let configuredInput: BenchmarkInput = {};
  const technique = adapter.technique;
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
    load: async (_controls, context) => {
      await session.get(context);
    },
    run: async (input, _sampleIndex, controls, context) => {
      context?.signal?.throwIfAborted();
      const current = session.loaded();
      if (current === undefined) throw new Error(`${techniqueLabel(technique)} source-outline target was not loaded`);
      const capture = await current.captureSourceOutline(
        input.fontFixture === undefined ? configuredInput : input,
        controls,
        context,
      );
      context?.signal?.throwIfAborted();
      return {
        bytes: capture.candidate.byteLength,
        hash: await sha256(capture.candidate),
        metrics: {
          techniqueBitmap: 0,
          techniqueMtsdf: technique === 'mtsdf' ? 1 : 0,
          techniqueSlug: technique === 'slug' ? 1 : 0,
          fixtureIsDotGothic: (input.fontFixture ?? configuredInput.fontFixture ?? 'inter') === 'dot-gothic-16' ? 1 : 0,
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
    dispose: session.dispose,
  };
}
