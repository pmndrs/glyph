import type { OriginSegment } from './render-state.js';

const EMPTY_SEGMENTS: readonly OriginSegment[] = Object.freeze([]);
/** Scanned records, as a multiple of the root's records, after which a hashed index is cheaper than more scans. */
const SCAN_BUDGET_FACTOR = 2;

/**
 * Finds where the committed draws hold a stable glyph id.
 *
 * A paragraph's records sit next to each other in draw order, so most lookups are the record after the previous
 * hit. The first glyph of a paragraph is found by scanning the id lanes; only a caller that keeps asking, such as
 * one measuring every label of a root, pays for a hashed index over the whole root, and that index holds no
 * per-glyph object. Nothing is built for a publication nobody queries.
 */
export class GlyphOriginIndex {
  #published: readonly OriginSegment[] = EMPTY_SEGMENTS;
  /** The published segments whose lanes can be indexed, resolved at the first lookup after a publication. */
  #segments: readonly OriginSegment[] | undefined;
  /** Origin lanes as they stood at that first lookup: each glyph's value at rest. */
  #rest: readonly Float32Array[] = [];
  #scanBudget = 0;
  #hashSlots: Int32Array | undefined;
  #hashSegments: Uint32Array | undefined;
  #hashRecords: Uint32Array | undefined;
  #hashShift = 0;
  #segment = 0;
  #record = 0;

  /** Adopts the draws of a new publication and forgets everything derived from the previous one. */
  reset(segments: readonly OriginSegment[]): void {
    this.#published = segments;
    this.#segments = undefined;
    this.#rest = [];
    this.#hashSlots = undefined;
    this.#hashSegments = undefined;
    this.#hashRecords = undefined;
  }

  #indexedSegments(): readonly OriginSegment[] {
    if (this.#segments !== undefined) return this.#segments;
    const segments = this.#published.filter(
      (segment) => segment.origins.array instanceof Float32Array && segment.stableIds.array instanceof Uint32Array,
    );
    let records = 0;
    for (const segment of segments) records += segment.count;
    this.#segments = segments;
    this.#rest = segments.map((segment) => {
      const width = segment.origins.vectorWidth;
      return (segment.origins.array as Float32Array).slice(
        segment.start * width,
        (segment.start + segment.count) * width,
      );
    });
    this.#scanBudget = records * SCAN_BUDGET_FACTOR;
    this.#segment = 0;
    this.#record = -1;
    return segments;
  }

  /** Moves the cursor to `stableId`; false when no committed draw holds it. */
  locate(stableId: number): boolean {
    const segments = this.#indexedSegments();
    const current = segments[this.#segment];
    if (current !== undefined) {
      const ids = current.stableIds.array as Uint32Array;
      const next = this.#record + 1;
      if (next < current.start + current.count && ids[next] === stableId) {
        this.#record = next;
        return true;
      }
    }
    if (this.#hashSlots === undefined && this.#scanBudget <= 0) this.#buildHash(segments);
    return this.#hashSlots === undefined ? this.#scan(segments, stableId) : this.#probe(segments, stableId);
  }

  /** The segment holding the located glyph. */
  get segment(): OriginSegment {
    return this.#indexedSegments()[this.#segment]!;
  }

  /** The located glyph's physical record index in its segment's buffers. */
  get record(): number {
    return this.#record;
  }

  /** The located glyph's origin lane component at rest, captured once per publication. */
  rest(component: 0 | 1): number {
    const segment = this.segment;
    return this.#rest[this.#segment]![(this.#record - segment.start) * segment.origins.vectorWidth + component]!;
  }

  #scan(segments: readonly OriginSegment[], stableId: number): boolean {
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segment = segments[index]!;
      const ids = (segment.stableIds.array as Uint32Array).subarray(segment.start, segment.start + segment.count);
      const found = ids.lastIndexOf(stableId);
      if (found === -1) {
        this.#scanBudget -= segment.count;
        continue;
      }
      this.#scanBudget -= segment.count - found;
      this.#segment = index;
      this.#record = segment.start + found;
      return true;
    }
    return false;
  }

  #probe(segments: readonly OriginSegment[], stableId: number): boolean {
    const slots = this.#hashSlots!;
    const mask = slots.length - 1;
    let slot = Math.imul(stableId, 0x9e37_79b1) >>> this.#hashShift;
    for (;;) {
      const entry = slots[slot]!;
      if (entry === 0) return false;
      const segment = this.#hashSegments![entry - 1]!;
      const record = this.#hashRecords![entry - 1]!;
      if ((segments[segment]!.stableIds.array as Uint32Array)[record] === stableId) {
        this.#segment = segment;
        this.#record = record;
        return true;
      }
      slot = (slot + 1) & mask;
    }
  }

  #buildHash(segments: readonly OriginSegment[]): void {
    let records = 0;
    for (const segment of segments) records += segment.count;
    let bits = 4;
    while (1 << bits < records * 2) bits += 1;
    const slots = new Int32Array(1 << bits);
    const mask = slots.length - 1;
    const shift = 32 - bits;
    const entrySegments = new Uint32Array(records);
    const entryRecords = new Uint32Array(records);
    let entries = 0;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]!;
      const ids = segment.stableIds.array as Uint32Array;
      for (let record = segment.start; record < segment.start + segment.count; record += 1) {
        const stableId = ids[record]!;
        let slot = Math.imul(stableId, 0x9e37_79b1) >>> shift;
        for (;;) {
          const entry = slots[slot]!;
          if (entry === 0) {
            entrySegments[entries] = index;
            entryRecords[entries] = record;
            entries += 1;
            slots[slot] = entries;
            break;
          }
          const held = (segments[entrySegments[entry - 1]!]!.stableIds.array as Uint32Array)[entryRecords[entry - 1]!];
          if (held === stableId) {
            // A later record of the same id replaces the earlier one.
            entrySegments[entry - 1] = index;
            entryRecords[entry - 1] = record;
            break;
          }
          slot = (slot + 1) & mask;
        }
      }
    }
    this.#hashSlots = slots;
    this.#hashSegments = entrySegments;
    this.#hashRecords = entryRecords;
    this.#hashShift = shift;
  }
}
