export interface PersistentSceneActivation<T> {
  reject(reason: unknown): void;
  resolve(value: T): void;
  wait(): Promise<T>;
}

/** Lets retained-scene controls arrive while the host is still completing cold activation. */
export function createPersistentSceneActivation<T>(): PersistentSceneActivation<T> {
  let resolveActivation!: (value: T) => void;
  let rejectActivation!: (reason: unknown) => void;
  const activation = new Promise<T>((resolve, reject) => {
    resolveActivation = resolve;
    rejectActivation = reject;
  });
  // A scene may be deactivated before any control waits on it. Keep that expected rejection handled locally.
  void activation.catch(() => undefined);
  return {
    reject: rejectActivation,
    resolve: resolveActivation,
    wait: () => activation,
  };
}
