import { SLUG_GLYPH_TABLE_STRIDE } from '../slug.js';

/** Texels per line of a resident band-curve texture; a renderer's shaders address it with this literal width. */
export const SLUG_RESIDENT_BAND_CURVE_WIDTH = 1024;

/** Table words: `[.., curveBase (8), .., referenceBase (11), .., entryCount (14), ..]`. */
const CURVE_BASE = 8;
const REFERENCE_BASE = 11;
const ENTRY_COUNT = 14;

/** What one `use` call changed, for the renderer to upload. */
export interface SlugAdmission {
  /** The band-curve texture gained lines: everything resident must be uploaded at the new size. */
  readonly grew: boolean;
  /** First and one-past-last band-curve line written. */
  readonly firstLine: number;
  readonly endLine: number;
  /** Table rows whose `referenceBase` now points at their resident entries. */
  readonly rows: readonly number[];
}

/**
 * One Slug page's band curves, resident only for the glyphs that have been drawn.
 *
 * The page keeps its baked curves and references on the CPU. The first time a published instance names a glyph, its
 * band entries (one per baked reference, with the curve's control points resolved as `pack2x16float` words
 * `[p0, p1, p2, 0]`) are appended to `entries` and its table row's `referenceBase` is pointed at them. A glyph's band
 * headers are relative to that base, so they do not change. Entries are appended in arrival order and never move or
 * leave; when they outgrow the texture, its line count doubles.
 */
export class SlugBandResidency {
  /** The renderer's glyph table: the baked rows with resident `referenceBase` words. */
  readonly table: Uint32Array;
  readonly #baked: Uint32Array;
  readonly #curves: DataView;
  readonly #references: DataView;
  readonly #resident: Uint8Array;
  #entries: Uint32Array;
  #lines = 1;
  #used = 0;

  constructor(curves: Uint8Array, references: Uint8Array, glyphTable: Uint8Array) {
    this.#curves = new DataView(curves.buffer, curves.byteOffset, curves.byteLength);
    this.#references = new DataView(references.buffer, references.byteOffset, references.byteLength);
    const copy = glyphTable.slice();
    this.#baked = new Uint32Array(copy.buffer, 0, copy.byteLength / 4);
    this.table = this.#baked.slice();
    this.#resident = new Uint8Array(this.#baked.length / SLUG_GLYPH_TABLE_STRIDE);
    this.#entries = new Uint32Array(SLUG_RESIDENT_BAND_CURVE_WIDTH * 4);
  }

  /** Resident band entries, `width * lines` texels of four words. Replaced when the texture grows. */
  get entries(): Uint32Array {
    return this.#entries;
  }
  get lines(): number {
    return this.#lines;
  }

  /**
   * Makes resident every glyph named by instances `[start, end)` of `lane`, which holds `stride` words per instance
   * with the glyph-table row first. Returns undefined when nothing new was needed.
   */
  use(lane: Uint32Array, start: number, end: number, stride: number): SlugAdmission | undefined {
    const rows: number[] = [];
    const firstEntry = this.#used;
    let grew = false;
    for (let offset = start * stride; offset < end * stride; offset += stride) {
      const row = lane[offset]!;
      if (row >= this.#resident.length || this.#resident[row] === 1) continue;
      this.#resident[row] = 1;
      grew = this.#admit(row) || grew;
      rows.push(row);
    }
    if (rows.length === 0) return undefined;
    return {
      grew,
      firstLine: Math.floor(firstEntry / SLUG_RESIDENT_BAND_CURVE_WIDTH),
      endLine: Math.ceil(this.#used / SLUG_RESIDENT_BAND_CURVE_WIDTH),
      rows,
    };
  }

  /** Appends one glyph's entries; true when the texture had to grow. */
  #admit(row: number): boolean {
    const word = row * SLUG_GLYPH_TABLE_STRIDE;
    const count = this.#baked[word + ENTRY_COUNT]!;
    const curveBase = this.#baked[word + CURVE_BASE]!;
    const referenceBase = this.#baked[word + REFERENCE_BASE]!;
    let grew = false;
    while (this.#used + count > this.#lines * SLUG_RESIDENT_BAND_CURVE_WIDTH) {
      this.#lines *= 2;
      grew = true;
    }
    if (grew) {
      const entries = new Uint32Array(this.#lines * SLUG_RESIDENT_BAND_CURVE_WIDTH * 4);
      entries.set(this.#entries);
      this.#entries = entries;
    }
    const entries = this.#entries;
    for (let index = 0; index < count; index += 1) {
      // A baked curve is texel `t` (p0, p1) and the first half of texel `t + 1` (p2), four halves per texel.
      const texel = (curveBase + this.#references.getUint16((referenceBase + index) * 2, true)) * 8;
      const target = (this.#used + index) * 4;
      entries[target] = this.#curves.getUint32(texel, true);
      entries[target + 1] = this.#curves.getUint32(texel + 4, true);
      entries[target + 2] = this.#curves.getUint32(texel + 8, true);
    }
    this.table[word + REFERENCE_BASE] = this.#used;
    this.#used += count;
    return grew;
  }
}
