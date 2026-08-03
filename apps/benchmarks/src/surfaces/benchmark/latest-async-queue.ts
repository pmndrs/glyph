export interface LatestAsyncCommit<Input, Output> {
  readonly input: Input;
  readonly output: Output;
}

export interface LatestAsyncQueue<Input, Output> {
  enqueue(input: Input): Promise<LatestAsyncCommit<Input, Output>>;
}

interface PendingRun<Input, Output> {
  input: Input;
  readonly waiters: Array<{
    readonly resolve: (commit: LatestAsyncCommit<Input, Output>) => void;
    readonly reject: (reason: unknown) => void;
  }>;
}

/** Runs one async mutation at a time and collapses queued inputs to the newest requested state. */
export function createLatestAsyncQueue<Input, Output>(
  run: (input: Input) => Promise<Output>,
): LatestAsyncQueue<Input, Output> {
  let pending: PendingRun<Input, Output> | undefined;
  let draining = false;

  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    try {
      while (pending !== undefined) {
        const current = pending;
        pending = undefined;
        try {
          const commit = { input: current.input, output: await run(current.input) };
          for (const waiter of current.waiters) waiter.resolve(commit);
        } catch (error) {
          for (const waiter of current.waiters) waiter.reject(error);
        }
      }
    } finally {
      draining = false;
      if (pending !== undefined) void drain();
    }
  };

  return {
    enqueue(input) {
      const result = new Promise<LatestAsyncCommit<Input, Output>>((resolve, reject) => {
        if (pending === undefined) pending = { input, waiters: [{ resolve, reject }] };
        else {
          pending.input = input;
          pending.waiters.push({ resolve, reject });
        }
      });
      void drain();
      return result;
    },
  };
}
