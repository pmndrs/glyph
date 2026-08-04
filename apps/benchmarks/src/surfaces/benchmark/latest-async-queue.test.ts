import { describe, expect, it } from 'vitest';

import { createLatestAsyncQueue } from './latest-async-queue';

describe('latest async queue', () => {
  it('runs one input at a time and collapses pending inputs to the newest state', async () => {
    const releases: Array<() => void> = [];
    const started: number[] = [];
    const queue = createLatestAsyncQueue(async (input: number) => {
      started.push(input);
      await new Promise<void>((resolve) => releases.push(resolve));
      return input * 2;
    });

    const first = queue.enqueue(1);
    const second = queue.enqueue(2);
    const third = queue.enqueue(3);
    expect(started).toEqual([1]);
    releases.shift()?.();
    await first;
    expect(started).toEqual([1, 3]);
    releases.shift()?.();

    await expect(second).resolves.toEqual({ input: 3, output: 6 });
    await expect(third).resolves.toEqual({ input: 3, output: 6 });
  });

  it('rejects every waiter for a failed collapsed input and continues draining', async () => {
    let fail = true;
    const queue = createLatestAsyncQueue(async (input: string) => {
      if (fail) {
        fail = false;
        throw new Error(`failed ${input}`);
      }
      return input.toUpperCase();
    });

    await expect(queue.enqueue('first')).rejects.toThrow('failed first');
    await expect(queue.enqueue('second')).resolves.toEqual({ input: 'second', output: 'SECOND' });
  });
});
