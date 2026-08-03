import * as THREE from 'three/webgpu';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  PersistentRenderSceneContext,
  PersistentRenderSceneRenderer,
} from '../../../renderer/persistent-render-host';
import { createRasterTechniqueComparisonPersistentScene } from './raster-technique-comparison';

const mocks = vi.hoisted(() => ({
  fontDisposals: [] as string[],
  onCandidateReady: undefined as (() => void) | undefined,
  onLineUpdates: undefined as (() => void) | undefined,
  onTextUpdates: undefined as (() => void) | undefined,
  lineUpdateCount: 0,
  lineUpdateTarget: 0,
  pendingLineReady: [] as Promise<void>[],
  pendingTextReady: [] as Promise<void>[],
  renderedCandidateTexts: [] as string[],
  textUpdateCount: 0,
  textUpdateTarget: 0,
  textDisposals: 0,
}));

vi.mock('@pmndrs/text', async () => {
  const threeModule = await import('three/webgpu');
  class MockText extends threeModule.Object3D {
    ready = Promise.resolve();
    renderedText: string;
    #candidateReady = false;
    #candidateText: string | undefined;

    constructor(properties: { readonly text?: string } = {}) {
      super();
      this.renderedText = properties.text ?? '';
    }

    setProperties(properties: { readonly fontSize?: number; readonly text?: string; readonly width?: number }): void {
      if (properties.text === undefined) {
        if (properties.fontSize === undefined && properties.width === undefined) return;
        const pending = mocks.pendingLineReady.shift();
        mocks.lineUpdateCount += 1;
        if (mocks.lineUpdateCount === mocks.lineUpdateTarget) mocks.onLineUpdates?.();
        this.ready = pending ?? Promise.resolve();
        return;
      }
      this.#candidateText = properties.text;
      const pending = mocks.pendingTextReady.shift();
      mocks.textUpdateCount += 1;
      if (mocks.textUpdateCount === mocks.textUpdateTarget) mocks.onTextUpdates?.();
      if (pending === undefined) {
        this.#candidateReady = true;
        this.ready = Promise.resolve();
        return;
      }
      this.#candidateReady = false;
      this.ready = pending.then(() => {
        this.#candidateReady = true;
        mocks.onCandidateReady?.();
      });
    }

    override updateMatrixWorld(force?: boolean): void {
      if (this.#candidateReady && this.#candidateText !== undefined) {
        this.renderedText = this.#candidateText;
        this.#candidateText = undefined;
      }
      super.updateMatrixWorld(force);
    }

    dispose(): void {
      mocks.textDisposals += 1;
    }
  }
  return { Text: MockText };
});

vi.mock('../../../workloads/font-assets/mtsdf', () => ({
  loadMtsdfFontAsset: async ({ signal }: { readonly signal?: AbortSignal }) => {
    signal?.throwIfAborted();
    return {
      font: { dispose: () => mocks.fontDisposals.push('mtsdf') },
      raster: {},
    };
  },
}));

vi.mock('../../../workloads/font-assets/slug', () => ({
  loadSlugFontAsset: async ({ signal }: { readonly signal?: AbortSignal }) => {
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
    mocks.lineUpdateCount = 0;
    mocks.lineUpdateTarget = 0;
    mocks.onCandidateReady = undefined;
    mocks.onLineUpdates = undefined;
    mocks.onTextUpdates = undefined;
    mocks.pendingLineReady.length = 0;
    mocks.pendingTextReady.length = 0;
    mocks.renderedCandidateTexts.length = 0;
    mocks.textUpdateCount = 0;
    mocks.textUpdateTarget = 0;
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

  it('keeps both committed candidate targets while one retained Text is still preparing', async () => {
    const fixture = rendererFixture();
    const scene = createRasterTechniqueComparisonPersistentScene({
      backend: 'webgpu',
      fontFixture: 'inter',
      text: 'committed',
    });
    const context = sceneContext(fixture.renderer);
    await scene.activate(context);
    scene.frame({ ...context, frameId: 1, timestamp: 10 });
    expect(mocks.renderedCandidateTexts).toEqual(['committed', 'committed']);
    mocks.renderedCandidateTexts.length = 0;

    const mtsdfReady = deferred<void>();
    const slugReady = deferred<void>();
    const textUpdates = deferred<void>();
    const firstCandidateReady = deferred<void>();
    mocks.pendingTextReady.push(mtsdfReady.promise, slugReady.promise);
    mocks.textUpdateTarget = 2;
    mocks.onTextUpdates = textUpdates.resolve;
    mocks.onCandidateReady = firstCandidateReady.resolve;

    const update = scene.setText('replacement');
    await textUpdates.promise;
    mtsdfReady.resolve();
    await firstCandidateReady.promise;

    scene.frame({ ...context, frameId: 2, timestamp: 20 });
    expect(mocks.renderedCandidateTexts).toEqual([]);

    slugReady.resolve();
    // Deactivation invalidates the queued revision after the negative observation and gives the controlled promises a
    // causal cleanup path without a timer or a frame-count retry.
    await scene.deactivate?.('released');
    await update;
  });

  it('restores the committed pair and resumes rendering after one retained Text update fails', async () => {
    const fixture = rendererFixture();
    const scene = createRasterTechniqueComparisonPersistentScene({
      backend: 'webgpu',
      fontFixture: 'inter',
      text: 'committed',
    });
    const context = sceneContext(fixture.renderer);
    await scene.activate(context);
    scene.frame({ ...context, frameId: 1, timestamp: 10 });
    mocks.renderedCandidateTexts.length = 0;

    const mtsdfReady = deferred<void>();
    const slugReady = deferred<void>();
    const textUpdates = deferred<void>();
    mocks.pendingTextReady.push(mtsdfReady.promise, slugReady.promise);
    mocks.textUpdateTarget = 2;
    mocks.onTextUpdates = textUpdates.resolve;

    const update = scene.setText('failed replacement');
    await textUpdates.promise;
    mtsdfReady.resolve();
    slugReady.reject(new Error('slug preparation failed'));

    await expect(update).rejects.toThrow('slug preparation failed');
    scene.frame({ ...context, frameId: 2, timestamp: 20 });
    expect(mocks.renderedCandidateTexts).toEqual(['committed', 'committed']);
    expect(fixture.state()).toEqual(hostRendererState(fixture.hostTarget));

    await scene.deactivate?.('released');
  });

  it('settles an in-flight paired update before disposal without publishing a partial target', async () => {
    const fixture = rendererFixture();
    const scene = createRasterTechniqueComparisonPersistentScene({
      backend: 'webgpu',
      fontFixture: 'inter',
      text: 'committed',
    });
    const context = sceneContext(fixture.renderer);
    await scene.activate(context);
    scene.frame({ ...context, frameId: 1, timestamp: 10 });
    mocks.renderedCandidateTexts.length = 0;

    const mtsdfReady = deferred<void>();
    const slugReady = deferred<void>();
    const textUpdates = deferred<void>();
    mocks.pendingTextReady.push(mtsdfReady.promise, slugReady.promise);
    mocks.textUpdateTarget = 2;
    mocks.onTextUpdates = textUpdates.resolve;

    const update = scene.setText('aborted replacement');
    await textUpdates.promise;
    const disposal = scene.deactivate?.('released');
    mtsdfReady.resolve();
    slugReady.resolve();

    await disposal;
    await update;
    expect(mocks.renderedCandidateTexts).toEqual([]);
    expect(mocks.fontDisposals).toEqual(['mtsdf', 'slug']);
    expect(mocks.textDisposals).toBe(2);
  });

  it('keeps resized targets intact until both retained lines are ready, then refreshes the pair together', async () => {
    const fixture = rendererFixture();
    const scene = createRasterTechniqueComparisonPersistentScene({
      backend: 'webgpu',
      fontFixture: 'inter',
      text: 'committed',
    });
    const context = sceneContext(fixture.renderer);
    await scene.activate(context);
    scene.frame({ ...context, frameId: 1, timestamp: 10 });
    mocks.renderedCandidateTexts.length = 0;

    const mtsdfReady = deferred<void>();
    const slugReady = deferred<void>();
    const lineUpdates = deferred<void>();
    const targetsResized = deferred<void>();
    mocks.pendingLineReady.push(mtsdfReady.promise, slugReady.promise);
    mocks.lineUpdateTarget = 2;
    mocks.onLineUpdates = lineUpdates.resolve;
    const originalSetSize = THREE.RenderTarget.prototype.setSize;
    const setSize = vi.spyOn(THREE.RenderTarget.prototype, 'setSize');
    setSize.mockImplementation(function (this: THREE.RenderTarget, width: number, height: number, depth?: number) {
      const result = originalSetSize.call(this, width, height, depth);
      if (setSize.mock.calls.length === 2) targetsResized.resolve();
      return result;
    });

    scene.resize?.({ ...context.viewport, width: 420, drawingBufferWidth: 840 });
    await lineUpdates.promise;
    scene.frame({ ...context, frameId: 2, timestamp: 20 });
    expect(mocks.renderedCandidateTexts).toEqual([]);
    expect(setSize).not.toHaveBeenCalled();

    mtsdfReady.resolve();
    slugReady.resolve();
    await targetsResized.promise;
    scene.frame({ ...context, frameId: 3, timestamp: 30 });
    expect(mocks.renderedCandidateTexts).toEqual(['committed', 'committed']);
    expect(setSize).toHaveBeenCalledTimes(2);
    expect(fixture.state()).toEqual(hostRendererState(fixture.hostTarget));

    setSize.mockRestore();
    await scene.deactivate?.('released');
  });
});

function deferred<Value>(): {
  readonly promise: Promise<Value>;
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (value: Value) => void;
} {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });
  return { promise, reject, resolve };
}

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
  const render = vi.fn<(...arguments_: unknown[]) => void>((scene) => {
    if (!(scene instanceof THREE.Scene)) return;
    scene.updateMatrixWorld(true);
    const text = scene.children[0] as { readonly renderedText?: string } | undefined;
    if (text?.renderedText !== undefined) mocks.renderedCandidateTexts.push(text.renderedText);
  });
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

function hostRendererState(hostTarget: THREE.RenderTarget) {
  return {
    autoClear: true,
    clearAlpha: 0.25,
    clearColor: 0x123456,
    renderTarget: hostTarget,
    scissor: [5, 6, 7, 8],
    scissorTest: true,
    viewport: [1, 2, 3, 4],
  };
}
