import { describe, expect, it } from 'vitest';

import { createLatestAsyncQueue } from './latest-async-queue';

describe('latest async queue', () => {
  it('finishes the active mutation and collapses queued requests to the latest input', async () => {
    const releases: Array<() => void> = [];
    const runs: number[] = [];
    const queue = createLatestAsyncQueue(async (input: number) => {
      runs.push(input);
      await new Promise<void>((resolve) => releases.push(resolve));
      return input * 2;
    });

    const first = queue.enqueue(1);
    const second = queue.enqueue(2);
    const third = queue.enqueue(3);
    expect(runs).toEqual([1]);

    releases.shift()!();
    await first;
    expect(runs).toEqual([1, 3]);
    releases.shift()!();

    await expect(second).resolves.toEqual({ input: 3, output: 6 });
    await expect(third).resolves.toEqual({ input: 3, output: 6 });
  });

  it('continues with the latest pending request after a failure', async () => {
    const queue = createLatestAsyncQueue(async (input: string) => {
      if (input === 'failed') throw new Error('failed');
      return input;
    });

    await expect(queue.enqueue('failed')).rejects.toThrow('failed');
    await expect(queue.enqueue('recovered')).resolves.toEqual({ input: 'recovered', output: 'recovered' });
  });
});
