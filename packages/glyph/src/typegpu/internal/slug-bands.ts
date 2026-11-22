/// <reference types="@webgpu/types" />
import type { TgpuRoot } from 'typegpu';
import type { PortableLeafResource } from '../../index.js';
import { SLUG_GLYPH_TABLE_STRIDE } from '../../raster/slug.js';
import { SLUG_RESIDENT_BAND_CURVE_WIDTH, SlugBandResidency } from '../../raster/internal/slug-residency.js';

/** The glyph lane holds `[glyph table row, placement slot]` per instance. */
const GLYPH_LANE_WIDTH = 2;

/**
 * One Slug page's band curves on the GPU, holding only the glyphs that have been drawn; the rule of Three's Slug page.
 *
 * The first time a frame publishes an instance of a glyph, its band entries are resolved into the band-curve texture
 * and its table row is pointed there, at commit, before the frame that draws it. When the entries outgrow the
 * texture, its line count doubles, the resident entries are uploaded again from the CPU copy, and `generation`
 * advances so bindings over the old view are rebuilt.
 */
export class ResidentSlugBands {
  /** The page's glyph table, with resident `referenceBase` words. */
  readonly glyphs: GPUBuffer;
  readonly #root: TgpuRoot;
  readonly #residency: SlugBandResidency;
  #texture: GPUTexture;
  #view: GPUTextureView;
  #generation = 0;

  constructor(
    root: TgpuRoot,
    curves: PortableLeafResource,
    references: PortableLeafResource,
    glyphTable: PortableLeafResource,
  ) {
    if (curves.kind !== 'buffer' || references.kind !== 'buffer' || glyphTable.kind !== 'buffer') {
      throw new TypeError('Slug resource group needs "curves", "references" and "glyphs" buffer members');
    }
    this.#root = root;
    this.#residency = new SlugBandResidency(curves.bytes, references.bytes, glyphTable.bytes);
    const table = this.#residency.table;
    this.glyphs = root.device.createBuffer({
      size: Math.max(SLUG_GLYPH_TABLE_STRIDE * 4, table.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    root.device.queue.writeBuffer(this.glyphs, 0, table);
    this.#texture = this.#createTexture();
    this.#view = this.#texture.createView();
  }
  get view(): GPUTextureView {
    return this.#view;
  }
  /** Advances whenever `view` is replaced. */
  get generation(): number {
    return this.#generation;
  }
  /** Makes every glyph that records `[start, start + count)` of the glyph lane draw resident. */
  use(glyphLane: Uint8Array, start: number, count: number): void {
    const lane = new Uint32Array(glyphLane.buffer, glyphLane.byteOffset, glyphLane.byteLength >>> 2);
    const admission = this.#residency.use(lane, start, start + count, GLYPH_LANE_WIDTH);
    if (admission === undefined) return;
    const queue = this.#root.device.queue;
    if (admission.grew) {
      this.#texture.destroy();
      this.#texture = this.#createTexture();
      this.#view = this.#texture.createView();
      this.#generation += 1;
    }
    const firstLine = admission.grew ? 0 : admission.firstLine;
    const lineWords = SLUG_RESIDENT_BAND_CURVE_WIDTH * 4;
    queue.writeTexture(
      { texture: this.#texture, origin: [0, firstLine, 0] },
      this.#residency.entries,
      { offset: firstLine * lineWords * 4, bytesPerRow: lineWords * 4 },
      [SLUG_RESIDENT_BAND_CURVE_WIDTH, admission.endLine - firstLine, 1],
    );
    const table = this.#residency.table;
    for (const row of admission.rows) {
      const from = row * SLUG_GLYPH_TABLE_STRIDE;
      queue.writeBuffer(this.glyphs, from * 4, table.subarray(from, from + SLUG_GLYPH_TABLE_STRIDE));
    }
  }
  dispose(): void {
    this.#texture.destroy();
    this.glyphs.destroy();
  }

  #createTexture(): GPUTexture {
    return this.#root.device.createTexture({
      size: [SLUG_RESIDENT_BAND_CURVE_WIDTH, this.#residency.lines, 1],
      format: 'rgba32uint',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
  }
}
