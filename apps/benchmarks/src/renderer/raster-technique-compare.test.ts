import * as THREE from 'three/webgpu';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PersistentRenderSceneContext, PersistentRenderSceneRenderer } from './persistent-render-host';
import { createRasterTechniqueComparisonPersistentScene } from './raster-technique-compare';

const mocks = vi.hoisted(() => ({
  fontDisposals: [] as string[],
  textDisposals: 0,
}));

vi.mock('@pmndrs/text', async () => {
  const threeModule = await import('three/webgpu');
  class MockText extends threeModule.Object3D {
    readonly ready = Promise.resolve();

    setProperties(): void {}

    dispose(): void {
      mocks.textDisposals += 1;
    }
  }
  return { Text: MockText };
});

vi.mock('./mtsdf-text', () => ({
  loadMtsdfFont: async (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    return {
      font: { dispose: () => mocks.fontDisposals.push('mtsdf') },
      raster: {},
    };
  },
}));

vi.mock('./slug-text', () => ({
  loadSlugFont: async (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    return {
      font: { dispose: () => mocks.fontDisposals.push('slug') },
      raster: {},
    };
  },
}));

describe('retained realtime raster comparison', () => {
  beforeEach(() => {
    mocks.fontDisposals.length = 0;
    mocks.textDisposals = 0;
  });

  it('borrows one renderer across activation, frames, resize, and disposal while restoring its state', async () => {
    const fixture = rendererFixture();
    const scene = createRasterTechniqueComparisonPersistentScene({
      backend: 'webgpu',
      fontFixture: 'inter',
      text: 'retained comparison',
    });
    const context = sceneContext(fixture.renderer);

    await scene.activate(context);
    scene.frame({ ...context, frameId: 1, timestamp: 10 });
    scene.resize?.({ ...context.viewport, width: 420, drawingBufferWidth: 840 });

    expect(fixture.compileAsync).toHaveBeenCalledTimes(5);
    expect(fixture.render).toHaveBeenCalledTimes(5);
    expect(fixture.state()).toEqual({
      autoClear: true,
      clearAlpha: 0.25,
      clearColor: 0x123456,
      renderTarget: fixture.hostTarget,
      scissor: [5, 6, 7, 8],
      scissorTest: true,
      viewport: [1, 2, 3, 4],
    });

    await scene.deactivate?.('released');
    expect(mocks.fontDisposals).toEqual(['mtsdf', 'slug']);
    expect(mocks.textDisposals).toBe(2);
  });

  it('releases partial resources when activation fails', async () => {
    const fixture = rendererFixture();
    fixture.compileAsync.mockRejectedValueOnce(new Error('pipeline failed'));
    const scene = createRasterTechniqueComparisonPersistentScene({
      backend: 'webgpu',
      fontFixture: 'inter',
      text: 'failed comparison',
    });

    await expect(scene.activate(sceneContext(fixture.renderer))).rejects.toThrow('pipeline failed');
    expect(mocks.fontDisposals).toEqual(['mtsdf', 'slug']);
    expect(mocks.textDisposals).toBe(2);
    expect(fixture.state()).toEqual({
      autoClear: true,
      clearAlpha: 0.25,
      clearColor: 0x123456,
      renderTarget: fixture.hostTarget,
      scissor: [5, 6, 7, 8],
      scissorTest: true,
      viewport: [1, 2, 3, 4],
    });
  });

  it('does not allocate comparison resources for an aborted activation', async () => {
    const fixture = rendererFixture();
    const controller = new AbortController();
    const failure = new DOMException('navigation cancelled comparison', 'AbortError');
    controller.abort(failure);
    const scene = createRasterTechniqueComparisonPersistentScene({
      backend: 'webgpu',
      fontFixture: 'inter',
      text: 'aborted comparison',
    });

    await expect(scene.activate(sceneContext(fixture.renderer, controller.signal))).rejects.toBe(failure);
    expect(fixture.compileAsync).not.toHaveBeenCalled();
    expect(fixture.render).not.toHaveBeenCalled();
    expect(mocks.fontDisposals).toEqual([]);
    expect(mocks.textDisposals).toBe(0);
  });
});

function sceneContext(renderer: PersistentRenderSceneRenderer, signal = new AbortController().signal) {
  return {
    renderer,
    rendererInitMs: 4,
    signal,
    viewport: {
      width: 360,
      height: 180,
      dpr: 2,
      drawingBufferWidth: 720,
      drawingBufferHeight: 360,
    },
  } satisfies PersistentRenderSceneContext;
}

function rendererFixture() {
  const hostTarget = new THREE.RenderTarget(4, 4);
  const state = {
    autoClear: true,
    clearAlpha: 0.25,
    clearColor: new THREE.Color(0x123456),
    renderTarget: hostTarget as THREE.RenderTarget | null,
    scissor: new THREE.Vector4(5, 6, 7, 8),
    scissorTest: true,
    viewport: new THREE.Vector4(1, 2, 3, 4),
  };
  const compileAsync = vi.fn<(...arguments_: unknown[]) => Promise<void>>(async () => undefined);
  const render = vi.fn<(...arguments_: unknown[]) => void>();
  const renderer = {
    get autoClear() {
      return state.autoClear;
    },
    set autoClear(value: boolean) {
      state.autoClear = value;
    },
    clear: vi.fn<(...arguments_: unknown[]) => void>(),
    compileAsync,
    getClearAlpha: () => state.clearAlpha,
    getClearColor: (target: THREE.Color) => target.copy(state.clearColor),
    getRenderTarget: () => state.renderTarget,
    getScissor: (target: THREE.Vector4) => target.copy(state.scissor),
    getScissorTest: () => state.scissorTest,
    getViewport: (target: THREE.Vector4) => target.copy(state.viewport),
    render,
    setClearColor: (color: THREE.ColorRepresentation, alpha = 1) => {
      state.clearColor.set(color);
      state.clearAlpha = alpha;
    },
    setRenderTarget: (target: THREE.RenderTarget | null) => {
      state.renderTarget = target;
    },
    setScissor: (scissor: THREE.Vector4 | number, y?: number, width?: number, height?: number) => {
      if (scissor instanceof THREE.Vector4) state.scissor.copy(scissor);
      else state.scissor.set(scissor, y!, width!, height!);
    },
    setScissorTest: (enabled: boolean) => {
      state.scissorTest = enabled;
    },
    setViewport: (viewport: THREE.Vector4 | number, y?: number, width?: number, height?: number) => {
      if (viewport instanceof THREE.Vector4) state.viewport.copy(viewport);
      else state.viewport.set(viewport, y!, width!, height!);
    },
  } as unknown as PersistentRenderSceneRenderer;
  return {
    compileAsync,
    hostTarget,
    render,
    renderer,
    state: () => ({
      autoClear: state.autoClear,
      clearAlpha: state.clearAlpha,
      clearColor: state.clearColor.getHex(),
      renderTarget: state.renderTarget,
      scissor: state.scissor.toArray(),
      scissorTest: state.scissorTest,
      viewport: state.viewport.toArray(),
    }),
  };
}
