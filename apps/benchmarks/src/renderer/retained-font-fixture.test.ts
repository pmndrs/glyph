import { FontRegistry, type RegisteredFont } from '@pmndrs/text';
import { describe, expect, it, vi } from 'vitest';

import { createRetainedFontFixtureController } from './retained-font-fixture';

describe('retained font fixture controller', () => {
  it('keeps the old font owned until the replacement commit finishes', async () => {
    const previous = fakeFont();
    const next = fakeFont();
    const commit = deferred<void>();
    const controller = createRetainedFontFixtureController(new FontRegistry(), {
      fixture: 'inter',
      asset: { font: previous.font },
    });

    const update = controller.update({
      fixture: 'source-serif-4',
      isCurrent: () => true,
      load: async () => ({ font: next.font }),
      commit: async () => commit.promise,
    });
    await Promise.resolve();

    expect(controller.current.asset.font).toBe(previous.font);
    expect(previous.dispose).not.toHaveBeenCalled();
    commit.resolve();
    await update;
    expect(controller.current.asset.font).toBe(next.font);
    expect(previous.dispose).toHaveBeenCalledOnce();
    expect(next.dispose).not.toHaveBeenCalled();
  });

  it('disposes a loaded candidate superseded before Text starts its commit', async () => {
    const previous = fakeFont();
    const next = fakeFont();
    const commit = vi.fn<() => Promise<void>>(async () => undefined);
    const controller = createRetainedFontFixtureController(new FontRegistry(), {
      fixture: 'inter',
      asset: { font: previous.font },
    });

    await expect(
      controller.update({
        fixture: 'source-serif-4',
        isCurrent: () => false,
        load: async () => ({ font: next.font }),
        commit,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(commit).not.toHaveBeenCalled();
    expect(previous.dispose).not.toHaveBeenCalled();
    expect(next.dispose).toHaveBeenCalledOnce();
  });

  it('retains a committed candidate when a newer request starts before its caller resumes', async () => {
    const previous = fakeFont();
    const next = fakeFont();
    let current = true;
    const controller = createRetainedFontFixtureController(new FontRegistry(), {
      fixture: 'inter',
      asset: { font: previous.font },
    });

    await expect(
      controller.update({
        fixture: 'source-serif-4',
        isCurrent: () => current,
        load: async () => ({ font: next.font }),
        commit: async () => {
          current = false;
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(controller.current.asset.font).toBe(next.font);
    expect(previous.dispose).toHaveBeenCalledOnce();
    expect(next.dispose).not.toHaveBeenCalled();
  });

  it('serializes competing loads so a stale request cannot dispose a shared registry result', async () => {
    const previous = fakeFont();
    const firstCandidate = fakeFont();
    const secondCandidate = fakeFont();
    const firstLoad = deferred<void>();
    let revision = 1;
    const loadOrder: number[] = [];
    const controller = createRetainedFontFixtureController(new FontRegistry(), {
      fixture: 'inter',
      asset: { font: previous.font },
    });
    const load = async (): Promise<{ readonly font: RegisteredFont }> => {
      loadOrder.push(loadOrder.length + 1);
      if (loadOrder.length === 1) await firstLoad.promise;
      return { font: loadOrder.length === 1 ? firstCandidate.font : secondCandidate.font };
    };

    const stale = controller.update({
      fixture: 'source-serif-4',
      isCurrent: () => revision === 1,
      load,
      commit: async () => undefined,
    });
    revision = 2;
    const current = controller.update({
      fixture: 'source-serif-4',
      isCurrent: () => revision === 2,
      load,
      commit: async () => undefined,
    });
    await Promise.resolve();
    expect(loadOrder).toEqual([1]);
    firstLoad.resolve();
    await expect(stale).rejects.toMatchObject({ name: 'AbortError' });
    await current;

    expect(loadOrder).toEqual([1, 2]);
    expect(firstCandidate.dispose).toHaveBeenCalledOnce();
    expect(controller.current.asset.font).toBe(secondCandidate.font);
    expect(secondCandidate.dispose).not.toHaveBeenCalled();
  });
});

function fakeFont(): { readonly font: RegisteredFont; readonly dispose: ReturnType<typeof vi.fn> } {
  const dispose = vi.fn<() => void>();
  return { font: { dispose } as unknown as RegisteredFont, dispose };
}

function deferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
