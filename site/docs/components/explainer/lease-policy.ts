export type GlyphActivation = 'pointer' | 'viewport';

export type GlyphLeaseTarget<Key> = Readonly<{
  key: Key;
  distance: number;
  ratio: number;
}>;

/**
 * Tracks pointer intent separately from viewport measurement.
 *
 * Viewport pages lease the targets nearest the viewport centre. Dense galleries
 * lease only targets the reader has engaged, newest first, so merely scrolling
 * past many cards does not repeatedly construct and discard Three scenes.
 */
export class GlyphLeasePolicy<Key> {
  #engaged = new Map<Key, number>();

  engage(key: Key, now: number): void {
    this.#engaged.set(key, now);
  }

  forget(key: Key): void {
    this.#engaged.delete(key);
  }

  retain(keys: Iterable<Key>): void {
    const retained = new Set(keys);
    for (const key of this.#engaged.keys()) if (!retained.has(key)) this.#engaged.delete(key);
  }

  clear(): void {
    this.#engaged.clear();
  }

  rank(
    targets: readonly GlyphLeaseTarget<Key>[],
    activation: GlyphActivation,
    priorityKey?: Key,
  ): readonly (readonly [Key, number])[] {
    const candidates = activation === 'pointer' ? targets.filter(({ key }) => this.#engaged.has(key)) : [...targets];
    candidates.sort((a, b) => {
      const priority = Number(b.key === priorityKey) - Number(a.key === priorityKey);
      if (priority !== 0) return priority;
      if (activation === 'pointer') {
        const recency = (this.#engaged.get(b.key) ?? 0) - (this.#engaged.get(a.key) ?? 0);
        if (recency !== 0) return recency;
      }
      return a.distance - b.distance || b.ratio - a.ratio;
    });
    return candidates.map(({ key }, index) => [key, candidates.length - index] as const);
  }
}
