export type GlyphPoolRequest<Key> = {
  key: Key;
  priority: number;
};

export type GlyphPoolSlot<Key> = {
  index: number;
  key: Key | undefined;
  /** The key this free slot last served. Its scene is still mounted, so the same key resumes without a remount. */
  warm: Key | undefined;
  lastUsed: number;
};

/**
 * Bounded LRU allocation for virtual render targets. The controller owns the actual renderer roots;
 * this class only decides which visible keys get a slot and which slots can be recycled.
 *
 * A released slot stays warm for the key it served. A returning key takes its own warm slot back, the pool grows
 * before it evicts another key's warm scene, and at the cap the least recently used free slot is recycled.
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
      if (slot.key !== undefined && !selectedKeys.has(slot.key)) this.#free(slot, now);
    }

    // Leases and warm slots are claimed first, so a newcomer cannot take the slot a returning key would resume.
    const assigned = new Map<Key, GlyphPoolSlot<Key>>();
    for (const { key } of selected) {
      const slot =
        this.#slots.find((candidate) => candidate.key === key) ??
        this.#slots.find((candidate) => candidate.key === undefined && candidate.warm === key);
      if (slot === undefined) continue;
      slot.key = key;
      slot.warm = undefined;
      slot.lastUsed = now;
      assigned.set(key, slot);
    }

    return selected.map(({ key }) => {
      const held = assigned.get(key);
      if (held !== undefined) return held;
      let slot: GlyphPoolSlot<Key> | undefined;
      if (this.#slots.length < this.#max) {
        slot = { index: this.#nextIndex++, key: undefined, warm: undefined, lastUsed: now };
        this.#slots.push(slot);
      } else {
        for (const candidate of this.#slots) {
          if (candidate.key !== undefined) continue;
          if (slot === undefined || candidate.lastUsed < slot.lastUsed) slot = candidate;
        }
      }
      if (slot === undefined) return undefined;
      slot.key = key;
      slot.warm = undefined;
      slot.lastUsed = now;
      return slot;
    });
  }

  #free(slot: GlyphPoolSlot<Key>, now: number) {
    slot.warm = slot.key;
    slot.key = undefined;
    slot.lastUsed = now;
  }

  release(key: Key, now: number) {
    const slot = this.#slots.find((candidate) => candidate.key === key);
    if (slot) this.#free(slot, now);
  }

  /** Forget a key entirely, so no free slot stays warm for a target that no longer exists. */
  forget(key: Key) {
    for (const slot of this.#slots) if (slot.warm === key) slot.warm = undefined;
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
