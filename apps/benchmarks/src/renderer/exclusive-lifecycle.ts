export interface ExclusiveLifecycleLease {
  release(): void;
}

export interface ExclusiveLifecycleCoordinator {
  acquire(signal?: AbortSignal): Promise<ExclusiveLifecycleLease>;
}

export function createExclusiveLifecycleCoordinator(): ExclusiveLifecycleCoordinator {
  let tail = Promise.resolve();

  return {
    async acquire(signal) {
      let releaseTurn = (): void => undefined;
      const turn = new Promise<void>((resolve) => {
        releaseTurn = resolve;
      });
      const predecessor = tail;
      tail = predecessor.then(
        () => turn,
        () => turn,
      );
      await predecessor.catch(() => undefined);

      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        releaseTurn();
      };
      if (signal?.aborted === true) {
        release();
        throw new DOMException('renderer lifecycle acquisition aborted', 'AbortError');
      }
      return { release };
    },
  };
}
