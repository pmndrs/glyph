import { GlyphError } from './glyph-error.js';

/**
 * Failures a renderer integration found while preparing or publishing a frame, held until the integration's render
 * or draw entry throws them. Each failure is thrown once: one found again by the next frame is still standing (the
 * same refusal, the same dead engine) and is not thrown again; one that stops being found and later returns is new.
 */
export class RenderFailures {
  #found: unknown[] = [];
  #standing: ReadonlySet<unknown> = new Set();

  /** Records a failure for the next {@link throwFound}; the same value recorded twice is one failure. */
  defer(error: unknown): void {
    if (!this.#found.includes(error)) this.#found.push(error);
  }

  /** Throws what was found since the last call and was not already thrown by it: one value, or an `AggregateError`. */
  throwFound(): void {
    const found = this.#found;
    if (found.length === 0 && this.#standing.size === 0) return;
    const standing = this.#standing;
    this.#found = [];
    this.#standing = new Set(found);
    const fresh = found.filter((error) => !standing.has(error));
    if (fresh.length === 1) throw fresh[0];
    if (fresh.length > 1) throw new AggregateError(fresh, 'Glyph text failed while rendering');
  }

  /** Forgets everything found; the owner was disposed. */
  clear(): void {
    this.#found = [];
    this.#standing = new Set();
  }
}

/** UTF-16 units of a text's content quoted in a failure message: enough to find it, short enough for a log line. */
const EXCERPT_UNITS = 40;

/** The text quoted as a failure names it: at most {@link EXCERPT_UNITS} units, never half a surrogate pair. */
function excerpt(text: string): string {
  if (text.length <= EXCERPT_UNITS) return JSON.stringify(text);
  const last = text.charCodeAt(EXCERPT_UNITS - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? EXCERPT_UNITS - 1 : EXCERPT_UNITS;
  return JSON.stringify(`${text.slice(0, end)}…`);
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The refusal of one text's preparation, thrown from a render: its message quotes the text so a console or error
 * report alone finds it, and `cause` is the engine's error.
 */
export function textRefusal(text: string, cause: unknown): GlyphError<'engine-failed'> {
  return new GlyphError('engine-failed', `Glyph text ${excerpt(text)} was not drawn: ${messageOf(cause)}`, { cause });
}

/** An exception an application's `onLayout` threw, quoting the text it was called for; `cause` is the exception. */
export function layoutCallbackFailure(text: string, cause: unknown): Error {
  return new Error(`onLayout of Glyph text ${excerpt(text)} threw: ${messageOf(cause)}`, { cause });
}
