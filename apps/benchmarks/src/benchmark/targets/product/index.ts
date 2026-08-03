import type { BenchmarkTarget, Capability } from '../../contracts';
import { createDeferredTarget } from '../shared';

function stableSyntheticHash(): string {
  let value = 2166136261;
  for (let index = 0; index < 4096; index += 1) value = Math.imul(value ^ (index & 0xff), 16777619);
  return (value >>> 0).toString(16).padStart(8, '0');
}

const syntheticTarget: BenchmarkTarget = {
  id: 'synthetic',
  label: 'Runner contract',
  detail: 'deterministic · CPU',
  color: 'violet',
  capabilities: new Set(['deterministic']),
  status: () => 'ready',
  load: async () => undefined,
  run: async () => ({ bytes: 4096, hash: stableSyntheticHash() }),
  dispose: async () => undefined,
};

type Backend = 'webgpu' | 'webgl2';
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

function bitmapTextTarget(backend: Backend): BenchmarkTarget {
  return createDeferredTarget(
    {
      id: `bitmap-text-${backend}`,
      label: `Bitmap text · ${backendLabel(backend)}`,
      detail: 'Selected font GLB · HarfRust layout · R8 KTX2 · instanced TSL',
      color: backendColor(backend),
      capabilities: rasterCapabilities,
      status: () => 'ready',
    },
    async () => (await import('../../../renderer/bitmap-text')).createBitmapTextTarget(backend),
    { forwardsConfiguration: true },
  );
}

function mtsdfTextTarget(backend: Backend): BenchmarkTarget {
  return createDeferredTarget(
    {
      id: `mtsdf-text-${backend}`,
      label: `MTSDF text · ${backendLabel(backend)}`,
      detail: 'Inter GLB · RGBA8 KTX2 · shared TSL graph',
      color: backendColor(backend),
      capabilities: rasterCapabilities,
      status: () => 'ready',
    },
    async () => (await import('../../../renderer/mtsdf-text')).createMtsdfTextTarget(backend),
  );
}

function slugTextTarget(backend: Backend): BenchmarkTarget {
  return createDeferredTarget(
    {
      id: `slug-text-${backend}`,
      label: `Slug text · ${backendLabel(backend)}`,
      detail: 'Inter GLB · analytic curves · shared TSL graph',
      color: backend === 'webgpu' ? 'green' : 'amber',
      capabilities: rasterCapabilities,
      status: () => 'ready',
    },
    async () => (await import('../../../renderer/slug-text')).createSlugTextTarget(backend),
  );
}

function externalRasterProofTarget(backend: Backend): BenchmarkTarget {
  return createDeferredTarget(
    {
      id: `external-raster-proof-${backend}`,
      label: `External raster proof · ${backendLabel(backend)}`,
      detail: 'Private package · public bake/load/Text lifecycle · retained TSL instances',
      color: backendColor(backend),
      capabilities: rasterCapabilities,
      status: () => 'ready',
    },
    async () => (await import('../../../renderer/external-raster-proof')).createExternalRasterProofTarget(backend),
  );
}

const reactTextTarget = () =>
  createDeferredTarget(
    {
      id: 'react-text-reconciliation',
      label: 'React Text reconciliation',
      detail: 'React 19 · R3F · WebGPURenderer · pinned oracle',
      color: 'violet',
      capabilities: new Set(['deterministic', 'loader', 'shaping', 'paragraph', 'raster']),
      status: () => 'ready',
    },
    async () => (await import('../../../renderer/react-text')).createReactTextTarget(),
  );

export function createProductTargets(): readonly BenchmarkTarget[] {
  return [
    syntheticTarget,
    externalRasterProofTarget('webgl2'),
    externalRasterProofTarget('webgpu'),
    bitmapTextTarget('webgl2'),
    bitmapTextTarget('webgpu'),
    mtsdfTextTarget('webgl2'),
    mtsdfTextTarget('webgpu'),
    slugTextTarget('webgl2'),
    slugTextTarget('webgpu'),
    reactTextTarget(),
  ];
}
