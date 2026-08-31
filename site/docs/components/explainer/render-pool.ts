export type GlyphPoolRequest<Key> = {
  key: Key;
  priority: number;
};

export type GlyphPoolSlot<Key> = {
  index: number;
  key: Key | undefined;
  lastUsed: number;
};

/**
 * Bounded LRU allocation for virtual render targets. The controller owns the actual renderer roots;
 * this class only decides which visible keys get a slot and which slots can be recycled.
 */
export class GlyphRenderPool<Key> {
  #max: number;
  #slots: GlyphPoolSlot<Key>[] = [];
  #nextIndex = 0;

  constructor(max: number) {
    this.#max = Math.max(1, max);
  }

  setMax(max: number) {
    this.#max = Math.max(1, max);
  }

  reconcile(requests: readonly GlyphPoolRequest<Key>[], now: number) {
    const selected = [...requests].sort((a, b) => b.priority - a.priority).slice(0, this.#max);
    const selectedKeys = new Set(selected.map((request) => request.key));

    for (const slot of this.#slots) {
      if (slot.key !== undefined && !selectedKeys.has(slot.key)) {
        slot.key = undefined;
        slot.lastUsed = now;
      }
    }

    return selected.map(({ key }) => {
      let slot = this.#slots.find((candidate) => candidate.key === key);
      if (!slot) {
        slot = this.#slots.find((candidate) => candidate.key === undefined);
        if (!slot && this.#slots.length < this.#max) {
          slot = { index: this.#nextIndex++, key: undefined, lastUsed: now };
          this.#slots.push(slot);
        }
        if (!slot) return undefined;
        slot.key = key;
      }
      slot.lastUsed = now;
      return slot;
    });
  }

  release(key: Key, now: number) {
    const slot = this.#slots.find((candidate) => candidate.key === key);
    if (slot) {
      slot.key = undefined;
      slot.lastUsed = now;
    }
  }

  retireIdle(now: number, ttl: number, protectedIndices: readonly number[] = []) {
    if (ttl < 0) return [];
    const protectedSet = new Set(protectedIndices);
    const retired = this.#slots.filter(
      (slot) => !protectedSet.has(slot.index) && slot.key === undefined && now - slot.lastUsed >= ttl,
    );
    if (retired.length) this.#slots = this.#slots.filter((slot) => !retired.includes(slot));
    return retired;
  }

  nextRetirementDelay(now: number, ttl: number, protectedIndices: readonly number[] = []) {
    const protectedSet = new Set(protectedIndices);
    const delays = this.#slots
      .filter((slot) => !protectedSet.has(slot.index) && slot.key === undefined)
      .map((slot) => Math.max(0, ttl - (now - slot.lastUsed)));
    return delays.length > 0 ? Math.min(...delays) : undefined;
  }

  get slots() {
    return this.#slots;
  }
}
