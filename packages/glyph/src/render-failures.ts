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
