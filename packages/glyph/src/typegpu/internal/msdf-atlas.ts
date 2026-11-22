/// <reference types="@webgpu/types" />
import type { TgpuRoot } from 'typegpu';
import type { PortableLeafResource } from '../../index.js';
import {
  MSDF_GLYPH_TABLE_LAYER_STEP,
  MSDF_GLYPH_TABLE_STRIDE,
  msdfBakedPages,
  type MsdfBakedPages,
} from '../../raster/msdf.js';

/** Edge of one resident atlas layer in texels, unless a single baked cell is larger. */
const RESIDENT_PAGE_SIZE = 256;
/** Bytes per baked texel; the last one is the true distance. */
const BAKED_TEXEL_BYTES = 4;
const ROW_BYTES = MSDF_GLYPH_TABLE_STRIDE * 4;
/** The effect lane holds `[shadowX, shadowY, outlineWidth, glyph]` per instance. */
const EFFECT_LANE_WIDTH = 4;

/**
 * One MSDF font's atlas on the GPU, holding only the glyphs that have been drawn; the rule of Three's
 * `RetainedMsdfAtlas`.
 *
 * The baked pages stay on the CPU as views. The first time a frame publishes an instance of a glyph, its cell is
 * copied into a resident layer and its glyph-table row is pointed there, at commit, before the frame that draws it.
 * Cells are shelf-packed in arrival order and never move or leave, so a row written once stays valid. When the
 * layers fill, the texture doubles its layer count with a GPU-side copy and `generation` advances, so bindings over
 * the old view are rebuilt.
 */
export class ResidentMsdfAtlas {
  /** Edge of every resident layer in texels. */
  readonly page: number;
  readonly singleChannel: boolean;
  /** The resident glyph table: `[left, top, width, height + layer * 4096]` per row, in resident texels. */
  readonly glyphs: GPUBuffer;
  readonly #root: TgpuRoot;
  readonly #baked: MsdfBakedPages;
  readonly #cells: Float32Array;
  readonly #rows: number;
  readonly #table: Float32Array;
  readonly #resident: Uint8Array;
  #texture: GPUTexture;
  #view: GPUTextureView;
  #layers = 1;
  #generation = 0;
  // The open shelf: the next cell goes at (penX, shelfTop) on `layer`; the shelf is as tall as its tallest cell.
  #layer = 0;
  #penX = 0;
  #shelfTop = 0;
  #shelfHeight = 0;

  constructor(root: TgpuRoot, pages: PortableLeafResource, glyphTable: PortableLeafResource, singleChannel: boolean) {
    if (pages.kind !== 'buffer') throw new Error('Expected the MSDF baked-pages token');
    if (glyphTable.kind !== 'buffer' || glyphTable.stride !== ROW_BYTES) {
      throw new TypeError('MSDF resource group needs a glyph table buffer member "glyphs"');
    }
    this.#root = root;
    this.#baked = msdfBakedPages(pages);
    const copy = glyphTable.bytes.slice();
    this.#cells = new Float32Array(copy.buffer, 0, copy.byteLength / 4);
    this.#rows = this.#cells.length / MSDF_GLYPH_TABLE_STRIDE;
    this.#table = new Float32Array(this.#cells.length);
    this.#resident = new Uint8Array(this.#rows);
    this.singleChannel = singleChannel;
    this.page = residentPageSize(this.#cells, this.#baked);
    this.glyphs = root.device.createBuffer({
      size: Math.max(ROW_BYTES, this.#table.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.#texture = this.#createTexture(1);
    this.#view = this.#texture.createView({ dimension: '2d-array' });
  }
  get view(): GPUTextureView {
    return this.#view;
  }
  /** Advances whenever `view` is replaced. */
  get generation(): number {
    return this.#generation;
  }
  /** Makes every glyph that records `[start, start + count)` of an effect lane draw resident. */
  use(effectLane: Uint8Array, start: number, count: number): void {
    const lane = new Float32Array(effectLane.buffer, effectLane.byteOffset, effectLane.byteLength >>> 2);
    let low = this.#rows;
    let high = -1;
    const end = (start + count) * EFFECT_LANE_WIDTH;
    for (let offset = start * EFFECT_LANE_WIDTH + EFFECT_LANE_WIDTH - 1; offset < end; offset += EFFECT_LANE_WIDTH) {
      const row = lane[offset]!;
      if (row >= this.#rows || this.#resident[row] !== 0) continue;
      this.#admit(row);
      low = Math.min(low, row);
      high = Math.max(high, row);
    }
    if (high < 0) return;
    const from = low * MSDF_GLYPH_TABLE_STRIDE;
    const to = (high + 1) * MSDF_GLYPH_TABLE_STRIDE;
    this.#root.device.queue.writeBuffer(this.glyphs, from * 4, this.#table.subarray(from, to));
  }
  dispose(): void {
    this.#texture.destroy();
    this.glyphs.destroy();
  }

  #createTexture(layers: number): GPUTexture {
    return this.#root.device.createTexture({
      size: [this.page, this.page, layers],
      format: this.singleChannel ? 'r8unorm' : 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
  }
  /** Doubles the layer count; the resident layers move over by a GPU copy. */
  #grow(): void {
    const layers = this.#layers * 2;
    const texture = this.#createTexture(layers);
    const encoder = this.#root.device.createCommandEncoder();
    encoder.copyTextureToTexture({ texture: this.#texture }, { texture }, [this.page, this.page, this.#layers]);
    this.#root.device.queue.submit([encoder.finish()]);
    this.#texture.destroy();
    this.#texture = texture;
    this.#view = texture.createView({ dimension: '2d-array' });
    this.#layers = layers;
    this.#generation += 1;
  }
  #admit(row: number): void {
    this.#resident[row] = 1;
    const source = row * MSDF_GLYPH_TABLE_STRIDE;
    const width = this.#cells[source + 2]!;
    const packedHeight = this.#cells[source + 3]!;
    const sourceLayer = Math.floor(packedHeight / MSDF_GLYPH_TABLE_LAYER_STEP);
    const height = packedHeight - sourceLayer * MSDF_GLYPH_TABLE_LAYER_STEP;
    if (width === 0 || height === 0) return;
    if (this.#penX + width > this.page) {
      this.#penX = 0;
      this.#shelfTop += this.#shelfHeight;
      this.#shelfHeight = 0;
    }
    if (this.#shelfTop + height > this.page) {
      this.#layer += 1;
      this.#penX = 0;
      this.#shelfTop = 0;
      this.#shelfHeight = 0;
      if (this.#layer >= this.#layers) this.#grow();
    }
    const sourcePage = this.#baked.pages[sourceLayer]!;
    const sourceOffset = (this.#cells[source + 1]! * sourcePage.width + this.#cells[source]!) * BAKED_TEXEL_BYTES;
    const destination = { texture: this.#texture, origin: [this.#penX, this.#shelfTop, this.#layer] };
    if (this.singleChannel) {
      // Only the true distance (the last channel) is kept.
      const texels = new Uint8Array(width * height);
      for (let line = 0; line < height; line += 1) {
        const from = sourceOffset + line * sourcePage.width * BAKED_TEXEL_BYTES + BAKED_TEXEL_BYTES - 1;
        for (let texel = 0; texel < width; texel += 1) {
          texels[line * width + texel] = sourcePage.bytes[from + texel * BAKED_TEXEL_BYTES]!;
        }
      }
      this.#root.device.queue.writeTexture(destination, texels, { bytesPerRow: width }, [width, height, 1]);
    } else {
      // Straight from the baked page: the cell's rows are strided views into it.
      this.#root.device.queue.writeTexture(
        destination,
        sourcePage.bytes,
        { offset: sourceOffset, bytesPerRow: sourcePage.width * BAKED_TEXEL_BYTES },
        [width, height, 1],
      );
    }
    this.#table[source] = this.#penX;
    this.#table[source + 1] = this.#shelfTop;
    this.#table[source + 2] = width;
    this.#table[source + 3] = height + this.#layer * MSDF_GLYPH_TABLE_LAYER_STEP;
    this.#penX += width;
    this.#shelfHeight = Math.max(this.#shelfHeight, height);
  }
}

/** A resident layer must hold the largest baked cell; fonts baked at a large em size get larger layers. */
function residentPageSize(cells: Float32Array, baked: MsdfBakedPages): number {
  let largest = 0;
  for (let source = 0; source < cells.length; source += MSDF_GLYPH_TABLE_STRIDE) {
    largest = Math.max(largest, cells[source + 2]!, cells[source + 3]! % MSDF_GLYPH_TABLE_LAYER_STEP);
  }
  let page = RESIDENT_PAGE_SIZE;
  while (page < largest) page *= 2;
  return Math.min(page, Math.max(baked.width, baked.height));
}
