import { describe, expect, it, vi } from 'vitest';

import { GlyphInputStream, GlyphOutboundDispatcher } from './channel';

describe('GlyphOutboundDispatcher', () => {
  it('coalesces adjacent pointer motion without reordering targets', () => {
    vi.useFakeTimers();
    const batches: unknown[][] = [];
    const dispatcher = new GlyphOutboundDispatcher((messages) => batches.push([...messages]));

    dispatcher.publish({ type: 'input', target: { proxyId: 'a' }, payload: { type: 'pointermove', x: 1 } });
    dispatcher.publish({ type: 'input', target: { proxyId: 'a' }, payload: { type: 'pointermove', x: 2 } });
    dispatcher.publish({ type: 'input', target: { proxyId: 'b' }, payload: { type: 'pointermove', x: 3 } });
    vi.advanceTimersByTime(30);

    expect(batches).toEqual([
      [
        { type: 'input', target: { proxyId: 'a' }, payload: { type: 'pointermove', x: 2 } },
        { type: 'input', target: { proxyId: 'b' }, payload: { type: 'pointermove', x: 3 } },
      ],
    ]);
    dispatcher.dispose();
    vi.useRealTimers();
  });

  it('flushes earlier motion and a click synchronously in occurrence order', () => {
    vi.useFakeTimers();
    const delivered: string[] = [];
    const dispatcher = new GlyphOutboundDispatcher((messages) => {
      delivered.push(...messages.map((message) => String((message.payload as { type: string }).type)));
    });

    dispatcher.publish({ type: 'input', target: 'root', payload: { type: 'pointermove' } });
    dispatcher.publish({ type: 'input', target: 'root', payload: { type: 'pointerdown' } });

    expect(delivered).toEqual(['pointermove', 'pointerdown']);
    expect(vi.getTimerCount()).toBe(0);
    dispatcher.dispose();
    vi.useRealTimers();
  });

  it('calls injected timer functions without rebinding their receiver', () => {
    let callback: (() => void) | undefined;
    const schedule = function (this: unknown, next: () => void) {
      expect(this).toBeUndefined();
      callback = next;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    };
    const cancel = function (this: unknown) {
      expect(this).toBeUndefined();
    };
    const delivered: string[] = [];
    const dispatcher = new GlyphOutboundDispatcher(
      (messages) => delivered.push(...messages.map((message) => message.type)),
      30,
      schedule,
      cancel,
    );

    dispatcher.publish({ type: 'input', target: 'root', payload: { type: 'pointermove' } });
    callback?.();

    expect(delivered).toEqual(['input']);
  });
});

describe('GlyphInputStream', () => {
  it('keeps discrete events ordered while collapsing only adjacent moves', () => {
    const stream = new GlyphInputStream();
    stream.push({ type: 'pointerdown', x: 1 });
    stream.push({ type: 'pointermove', x: 2 });
    stream.push({ type: 'pointermove', x: 3 });
    stream.push({ type: 'pointerup', x: 4 });

    expect(stream.drain()).toEqual([
      { type: 'pointerdown', x: 1 },
      { type: 'pointermove', x: 3 },
      { type: 'pointerup', x: 4 },
    ]);
    expect(stream.pending).toBe(0);
  });
});
