export type GlyphChannelTarget =
  | 'all'
  | 'root'
  | {
      rootId?: string;
      proxyId?: string;
    };

export type GlyphSceneInput = {
  type: string;
  buttons?: number;
  pointerId?: number;
  x?: number;
  y?: number;
  value?: string;
};

export type GlyphChannelMessage<Payload = unknown> = {
  channel: 'glyph';
  version: 1;
  sequence: number;
  type: string;
  source: string;
  target: GlyphChannelTarget;
  payload: Payload;
  timestamp: number;
};

export type GlyphOutboundMessage = Readonly<{
  type: string;
  payload: unknown;
  target: GlyphChannelTarget;
}>;

type Schedule = (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
type Cancel = (timer: ReturnType<typeof setTimeout>) => void;

const scheduleTimeout: Schedule = (callback, delay) => setTimeout(callback, delay);
const cancelTimeout: Cancel = (timer) => clearTimeout(timer);

/**
 * One ordered, page-local outbound stream.
 *
 * Pointer motion is the only coalescible traffic. A discrete event flushes every
 * earlier move before itself, so pointerdown, pointerup, key, control, and scene
 * messages cannot sit behind a timer or overtake input that happened first.
 */
export class GlyphOutboundDispatcher {
  #pending: GlyphOutboundMessage[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    readonly deliver: (messages: readonly GlyphOutboundMessage[]) => void,
    readonly delay = 30,
    readonly schedule: Schedule = scheduleTimeout,
    readonly cancel: Cancel = cancelTimeout,
  ) {}

  publish(message: GlyphOutboundMessage): void {
    const previous = this.#pending.at(-1);
    if (
      isPointerMove(message) &&
      previous !== undefined &&
      isPointerMove(previous) &&
      sameTarget(previous.target, message.target)
    ) {
      this.#pending[this.#pending.length - 1] = message;
    } else {
      this.#pending.push(message);
    }

    if (!isPointerMove(message)) {
      this.flush();
      return;
    }
    if (this.#timer === undefined) {
      const schedule = this.schedule;
      this.#timer = schedule(() => this.flush(), this.delay);
    }
  }

  flush(): void {
    if (this.#timer !== undefined) {
      const cancel = this.cancel;
      cancel(this.#timer);
    }
    this.#timer = undefined;
    if (this.#pending.length === 0) return;
    this.deliver(this.#pending.splice(0));
  }

  dispose(): void {
    if (this.#timer !== undefined) {
      const cancel = this.cancel;
      cancel(this.#timer);
    }
    this.#timer = undefined;
    this.#pending.length = 0;
  }
}

/** Stable mailbox passed into one R3F scene; the scene drains it inside `useFrame`. */
export class GlyphInputStream {
  #events: GlyphSceneInput[] = [];

  push(input: GlyphSceneInput): void {
    const previous = this.#events.at(-1);
    if (input.type === 'pointermove' && previous?.type === 'pointermove') this.#events[this.#events.length - 1] = input;
    else this.#events.push(input);
  }

  drain(): readonly GlyphSceneInput[] {
    return this.#events.splice(0);
  }

  clear(): void {
    this.#events.length = 0;
  }

  get pending(): number {
    return this.#events.length;
  }
}

export function sameTarget(a: GlyphChannelTarget, b: GlyphChannelTarget): boolean {
  if (a === b) return true;
  if (typeof a === 'string' || typeof b === 'string') return false;
  return a.rootId === b.rootId && a.proxyId === b.proxyId;
}

function isPointerMove(message: GlyphOutboundMessage): boolean {
  return message.type === 'input' && isGlyphSceneInput(message.payload) && message.payload.type === 'pointermove';
}

export function isGlyphSceneInput(value: unknown): value is GlyphSceneInput {
  return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string';
}
