import type { BenchmarkFontFixture } from '../../font-fixtures';
import type { BenchmarkTarget } from '../../contracts';
import {
  createBitmapFiniteScene,
  disposeBitmapFiniteScene,
  renderBitmapFiniteProduct,
  type BitmapFiniteScene,
} from '../../low-level/raster/bitmap-finite-scene';
import type { RendererBackend } from '../../../renderer/webgpu-renderer';

type BitmapTextProductState =
  | { readonly kind: 'empty' }
  | { readonly kind: 'ready'; readonly resources: BitmapFiniteScene };

/** Product benchmark lifecycle for the finite bitmap reference scene. */
export function createBitmapTextTarget(backend: RendererBackend): BenchmarkTarget {
  let state: BitmapTextProductState = { kind: 'empty' };
  let fontFixture: BenchmarkFontFixture = 'inter';
  return {
    id: `bitmap-text-${backend}`,
    label: backend === 'webgpu' ? 'Bitmap text · WebGPU' : 'Bitmap text · WebGL',
    detail: 'Selected font GLB · HarfRust layout · R8 KTX2 · instanced TSL',
    color: backend === 'webgpu' ? 'cyan' : 'amber',
    capabilities: new Set(['deterministic', 'font-bytes', 'wasm', 'shaping', 'paragraph', 'raster']),
    configure: (input) => {
      fontFixture = input.fontFixture ?? 'inter';
    },
    status: () => 'ready',
    load: async (controls, context) => {
      if (state.kind === 'ready') return;
      state = {
        kind: 'ready',
        resources: await createBitmapFiniteScene({
          backend,
          dpr: controls.dpr,
          fontFixture,
          delivery: 'baked',
          ...(context?.signal === undefined ? {} : { signal: context.signal }),
          ...(context?.renderer === undefined ? {} : { renderer: context.renderer }),
        }),
      };
    },
    run: async (_input, _sampleIndex, _controls, context) => {
      context?.signal?.throwIfAborted();
      if (state.kind !== 'ready') throw new Error('bitmap text target was not loaded');
      return renderBitmapFiniteProduct(state.resources);
    },
    dispose: async () => {
      if (state.kind !== 'ready') return;
      const resources = state.resources;
      state = { kind: 'empty' };
      await disposeBitmapFiniteScene(resources);
    },
  };
}
