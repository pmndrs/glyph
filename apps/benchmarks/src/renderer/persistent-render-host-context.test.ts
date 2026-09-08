import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { CanvasViewController } from './canvas-view-controller';
import type { PersistentRenderHost, PersistentRenderScene } from './persistent-render-host';

interface EffectSlot {
  cleanup: (() => void) | undefined;
  dependencies: readonly unknown[] | undefined;
}

const hookHarness = vi.hoisted(() => {
  const effects: EffectSlot[] = [];
  const references: Array<{ current: unknown }> = [];
  const states: unknown[] = [];
  let effectIndex = 0;
  let referenceIndex = 0;
  let stateIndex = 0;

  return {
    beginRender(): void {
      effectIndex = 0;
      referenceIndex = 0;
      stateIndex = 0;
    },
    reset(): void {
      effects.length = 0;
      references.length = 0;
      states.length = 0;
      effectIndex = 0;
      referenceIndex = 0;
      stateIndex = 0;
    },
    unmount(): void {
      for (const effect of effects) effect.cleanup?.();
      effects.length = 0;
    },
    useEffect(effect: () => (() => void) | void, dependencies?: readonly unknown[]): void {
      const index = effectIndex++;
      const previous = effects[index];
      const changed =
        previous === undefined ||
        dependencies === undefined ||
        previous.dependencies === undefined ||
        dependencies.length !== previous.dependencies.length ||
        dependencies.some(
          (dependency, dependencyIndex) => !Object.is(dependency, previous.dependencies?.[dependencyIndex]),
        );
      if (!changed) return;
      previous?.cleanup?.();
      effects[index] = { cleanup: effect() ?? undefined, dependencies };
    },
    useRef<T>(initialValue: T): { current: T } {
      const index = referenceIndex++;
      references[index] ??= { current: initialValue };
      return references[index] as { current: T };
    },
    useState<T>(initialValue: T | (() => T)): [T, (next: T) => void] {
      const index = stateIndex++;
      if (!(index in states))
        states[index] = typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue;
      return [
        states[index] as T,
        (next: T) => {
          states[index] = next;
        },
      ];
    },
  };
});

const runtimeWorld = vi.hoisted(() => ({
  get: vi.fn<(trait: unknown) => unknown>(),
  set: vi.fn<(trait: unknown, value: unknown) => void>(),
}));
const createHost = vi.hoisted(() => vi.fn<() => Promise<PersistentRenderHost>>());

vi.mock('react', async (importOriginal) => {
  const original = await importOriginal<typeof import('react')>();
  return {
    ...original,
    useEffect: hookHarness.useEffect,
    useRef: hookHarness.useRef,
    useState: hookHarness.useState,
  };
});

vi.mock('../benchmark/runtime-world', async (importOriginal) => {
  const original = await importOriginal<typeof import('../benchmark/runtime-world')>();
  return { ...original, useRuntimeWorld: () => runtimeWorld };
});

vi.mock('./persistent-render-host', async (importOriginal) => {
  const original = await importOriginal<typeof import('./persistent-render-host')>();
  return { ...original, createPersistentRenderHost: createHost };
});

import { RuntimeCanvasSettings } from '../benchmark/runtime-world';
import { PersistentRenderHostProvider } from './persistent-render-host-context';

interface ProviderValue {
  activateSurface(
    request: {
      readonly anchor: HTMLElement;
      readonly controller: { current: CanvasViewController | undefined };
      readonly label: string;
      readonly pan: boolean;
      readonly scene: PersistentRenderScene;
      readonly zoom: boolean;
    },
    signal?: AbortSignal,
  ): Promise<{ release(): Promise<void> }>;
  runExclusiveJob<T>(job: () => T): Promise<Awaited<T>>;
}

describe('PersistentRenderHostProvider lifecycle', () => {
  const removeCanvas = vi.fn<() => void>();
  const prependCanvas = vi.fn<(node: Node) => void>();
  const observeResize = vi.fn<(target: Element) => void>();
  const disconnectResize = vi.fn<() => void>();
  const fakeCanvas = {
    addEventListener: vi.fn<(...arguments_: unknown[]) => void>(),
    ariaLabel: '',
    className: '',
    dataset: {} as Record<string, string>,
    remove: removeCanvas,
    removeEventListener: vi.fn<(...arguments_: unknown[]) => void>(),
    style: { backgroundColor: '' },
  } as unknown as HTMLCanvasElement;
  const host = {
    dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    replaceScene: vi
      .fn<() => Promise<{ generation: number; release(): Promise<void> }>>()
      .mockResolvedValue({ generation: 1, release: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) }),
    resize: vi.fn<(...arguments_: unknown[]) => void>(),
    runExclusiveJob: vi.fn<(job: () => unknown) => Promise<unknown>>().mockImplementation(async (job) => job()),
  } as unknown as PersistentRenderHost;

  beforeEach(() => {
    hookHarness.reset();
    vi.clearAllMocks();
    createHost.mockResolvedValue(host);
    vi.stubGlobal('document', { createElement: vi.fn<() => HTMLCanvasElement>(() => fakeCanvas) });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        disconnect = disconnectResize;
        observe = observeResize;
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('ordinary rerender retains canvas settings and the existing host', async () => {
    const reportError = vi.fn<(error: unknown) => void>();
    const firstValue = renderProvider(reportError);
    await firstValue.activateSurface({
      anchor: { clientHeight: 360, clientWidth: 640, prepend: prependCanvas } as unknown as HTMLElement,
      controller: { current: undefined },
      label: 'Live MTSDF benchmark using webgpu',
      pan: true,
      scene: {
        activate: vi.fn<() => void>(),
        frame: vi.fn<() => void>(),
        id: 'scene',
      },
      zoom: false,
    });
    const settingsWrites = runtimeWorld.set.mock.calls.length;

    const secondValue = renderProvider(reportError);
    await secondValue.runExclusiveJob(() => undefined);

    expect(runtimeWorld.set).toHaveBeenCalledTimes(settingsWrites);
    expect(removeCanvas).not.toHaveBeenCalled();
    expect(host.dispose).not.toHaveBeenCalled();
    expect(createHost).toHaveBeenCalledTimes(1);

    const disposalFailure = new Error('dispose failed');
    vi.mocked(host.dispose).mockRejectedValueOnce(disposalFailure);
    hookHarness.unmount();
    await Promise.resolve();

    expect(runtimeWorld.set).toHaveBeenLastCalledWith(RuntimeCanvasSettings, {
      controller: undefined,
      label: 'Text rendering canvas',
      panEnabled: false,
      zoomEnabled: false,
    });
    expect(removeCanvas).toHaveBeenCalledTimes(1);
    expect(host.dispose).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(disposalFailure);
  });
});

function renderProvider(onError: (error: unknown) => void): ProviderValue {
  hookHarness.beginRender();
  const element = PersistentRenderHostProvider({
    backend: 'webgpu',
    children: undefined,
    dpr: 2,
    onError,
  }) as ReactElement<{ value: ProviderValue }>;
  return element.props.value;
}
