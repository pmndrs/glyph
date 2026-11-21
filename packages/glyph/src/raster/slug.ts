import {
  SLUG_EXTENSION,
  SLUG_FORMAT_VERSION,
  SLUG_GLYPH_RECORD_STRIDE,
  SLUG_KIND,
  slugDescriptor,
  type SlugDescriptor,
  type SlugOptions,
} from '../internal/slug-contract.js';
import {
  defineRasterFormat,
  type RasterResourceId,
  type RasterFormat,
  type RasterFormatId,
} from '../config/raster-format.js';

export {
  SLUG_GLYPH_RECORD_STRIDE,
  SLUG_PLANE_UNITS_PER_EM,
  type SlugDescriptor,
  type SlugOptions,
} from '../internal/slug-contract.js';

const ABSENT_PAGE = 0xffff;

export interface SlugPageData {
  readonly resource: RasterResourceId;
  readonly curveWidth: number;
  readonly curveHeight: number;
  readonly curveBytes: Uint8Array;
  readonly headerCount: number;
  readonly headerWidth: number;
  readonly headerHeight: number;
  readonly headerBytes: Uint8Array;
  readonly referenceCount: number;
  readonly referenceWidth: number;
  readonly referenceHeight: number;
  readonly referenceBytes: Uint8Array;
}

export interface SlugData {
  readonly planeUnitsPerEm: number;
  readonly records: Uint8Array;
  readonly pages: readonly SlugPageData[];
}

/** Renderer-neutral Slug identity, decoding, and ownership. */
export const slug: RasterFormat<
  RasterFormatId & 'pmndrs.slug',
  typeof SLUG_KIND,
  SlugOptions | undefined,
  SlugDescriptor,
  SlugData
> = defineRasterFormat({
  id: 'pmndrs.slug',
  kind: SLUG_KIND,
  extension: SLUG_EXTENSION,
  version: SLUG_FORMAT_VERSION,
  textEffects: [],
  runtimeBaker: () => import('../runtime-bakers/slug.js'),
  descriptor(options: SlugOptions | undefined): SlugDescriptor {
    return slugDescriptor(options);
  },
  async decode(font, raster, signal): Promise<SlugData> {
    signal?.throwIfAborted();
    const { decodeSlugData } = await import('./internal/slug-decoder.js');
    const data = await decodeSlugData(font, raster, signal);
    signal?.throwIfAborted();
    return data;
  },
  dispose() {},
});

import { f32, techniqueProgram, u32 } from '../config/codec-program.js';
import { id, type CodecBufferId } from '../config/codec.js';
import type { RasterCodec } from '../config/raster.js';
import { registerGlyphRasterCodec } from '../internal/raster-codec-registry.js';
import { defineTechniqueSchema, type TechniqueSchema } from '../config/schema.js';

const SLUG_RECT_BUFFER_ID: CodecBufferId = id.buffer('pmndrs.slug/rect');
const SLUG_COLOR_BUFFER_ID: CodecBufferId = id.buffer('pmndrs.slug/color');
const SLUG_GLYPH_BUFFER_ID: CodecBufferId = id.buffer('pmndrs.slug/glyph');

/** `u32` words per glyph in a page's `glyphs` table. */
export const SLUG_GLYPH_TABLE_STRIDE = 16;

/**
 * The authoritative physical shape of the Slug format.
 *
 * An instance carries what differs between two drawings of one glyph: where it is, how large, how it is painted, and
 * which glyph it is. What every drawing of a glyph shares lives once per glyph in its page's `glyphs` table, addressed
 * by the `glyph` lane. A row is sixteen little-endian words: the em-space quad `[left, top, width, height]` and the
 * band transform `[scaleX, scaleY, offsetX, offsetY]` as `f32` bits, then `[curveBase, horizontalHeaderBase,
 * verticalHeaderBase, referenceBase]` and `[horizontalBands, verticalBands, entryCount, 0]` as `u32`. The second `glyph` lane
 * is free for the host: the Three renderer stores the placement slot there.
 *
 * A page holds the band headers (`(count << 16) | offset`, as baked), which a renderer uploads, and the baked curves
 * (`rgba16float` texels) and glyph-local references (`u16`), which stay on the CPU: a renderer resolves each band
 * entry's curve into its own band-curve texture when a glyph is first drawn (see `SlugBandResidency`) and points the
 * row's `referenceBase` there. The row's third `u32` vector holds the glyph's entry count in its third word.
 */
export const slugSchema: TechniqueSchema<
  {
    readonly rect: {
      readonly id: typeof SLUG_RECT_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['left', 'top', 'width', 'height'];
    };
    readonly color: {
      readonly id: typeof SLUG_COLOR_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['red', 'green', 'blue', 'alpha'];
    };
    readonly glyph: {
      readonly id: typeof SLUG_GLYPH_BUFFER_ID;
      readonly scalar: 'u32';
      readonly lanes: readonly ['glyph', 'unused1'];
    };
  },
  {
    readonly f32: readonly ['bearingX', 'bearingY', 'width', 'height'];
    readonly u32: readonly ['glyph'];
  },
  {
    readonly page: {
      readonly kind: 'group';
      readonly cardinality: 'many';
      readonly members: {
        readonly headers: { readonly kind: 'texture'; readonly format: 'r32uint' };
        readonly curves: { readonly kind: 'buffer' };
        readonly references: { readonly kind: 'buffer' };
        readonly glyphs: { readonly kind: 'buffer' };
      };
    };
  },
  typeof slug.id
> = defineTechniqueSchema({
  technique: slug.id,
  scope: 'glyph',
  glyphOrigin: { buffer: 'rect' },
  binding: {
    f32: ['bearingX', 'bearingY', 'width', 'height'],
    u32: ['glyph'],
  },
  buffers: {
    rect: { id: SLUG_RECT_BUFFER_ID, scalar: 'f32', lanes: ['left', 'top', 'width', 'height'] },
    color: { id: SLUG_COLOR_BUFFER_ID, scalar: 'f32', lanes: ['red', 'green', 'blue', 'alpha'] },
    glyph: { id: SLUG_GLYPH_BUFFER_ID, scalar: 'u32', lanes: ['glyph', 'unused1'] },
  },
  resources: {
    page: {
      kind: 'group',
      cardinality: 'many',
      members: {
        headers: { kind: 'texture', format: 'r32uint' },
        curves: { kind: 'buffer' },
        references: { kind: 'buffer' },
        glyphs: { kind: 'buffer' },
      },
    },
  },
  render: { resource: 'page', geometry: { kind: 'synthetic-quad' } },
});

export const slugCodec: RasterCodec<typeof slug, typeof slugSchema> = registerGlyphRasterCodec({
  raster: slug,
  schema: slugSchema,
  codecBody() {
    const p = techniqueProgram(slugSchema);
    const { inlineOrigin, blockOrigin, fontSize, color } = p.semantics;
    const { bearingX, bearingY, width, height, glyph } = p.binding;
    return p.compile({
      rect: [
        f32.add(inlineOrigin, f32.mul(bearingX, fontSize)),
        f32.sub(blockOrigin, f32.mul(bearingY, fontSize)),
        f32.mul(width, fontSize),
        f32.mul(height, fontSize),
      ],
      color: [color.red, color.green, color.blue, color.alpha],
      glyph: [glyph, u32.const(0)],
    });
  },
  compileFont(compiler) {
    const data = compiler.font.data;
    const tables = slugGlyphTables(data);
    for (const [index, page] of data.pages.entries()) {
      compiler.retain('page', page.resource, slugPagePayload(page, tables.pages[index]!));
    }
    const view = new DataView(data.records.buffer, data.records.byteOffset);
    const record = (row: number) => row * SLUG_GLYPH_RECORD_STRIDE;
    const page = (row: number) => view.getUint16(record(row) + 8, true);
    const normalized = (row: number, offset: number) =>
      view.getInt16(record(row) + offset, true) / data.planeUnitsPerEm;
    return compiler.compile({
      strikes: [0],
      resource: (glyph) => {
        const selected = page(glyph);
        return selected === ABSENT_PAGE ? undefined : data.pages[selected]!.resource;
      },
      f32: {
        bearingX: (row) => normalized(row, 0),
        bearingY: (row) => normalized(row, 6),
        width: (row) => normalized(row, 4) - normalized(row, 0),
        height: (row) => normalized(row, 6) - normalized(row, 2),
      },
      u32: { glyph: (row) => tables.rows[row]! },
    });
  },
});

/**
 * One table per page, holding a row for each glyph the page draws, and each glyph's row in its page's table. Rows are
 * page-local so a font of many pages does not repeat every glyph in every table.
 */
function slugGlyphTables(data: SlugData): { readonly pages: Uint8Array[]; readonly rows: Uint32Array } {
  const view = new DataView(data.records.buffer, data.records.byteOffset, data.records.byteLength);
  const glyphCount = data.records.byteLength / SLUG_GLYPH_RECORD_STRIDE;
  const rows = new Uint32Array(glyphCount);
  const counts = data.pages.map(() => 0);
  for (let glyph = 0; glyph < glyphCount; glyph += 1) {
    const page = view.getUint16(glyph * SLUG_GLYPH_RECORD_STRIDE + 8, true);
    if (page === ABSENT_PAGE) continue;
    rows[glyph] = counts[page]!;
    counts[page] = counts[page]! + 1;
  }
  const pages = counts.map((count) => new Uint8Array(Math.max(1, count) * SLUG_GLYPH_TABLE_STRIDE * 4));
  const tables = pages.map((bytes) => new DataView(bytes.buffer));
  for (let glyph = 0; glyph < glyphCount; glyph += 1) {
    const record = glyph * SLUG_GLYPH_RECORD_STRIDE;
    const page = view.getUint16(record + 8, true);
    if (page === ABSENT_PAGE) continue;
    writeSlugGlyphRow(tables[page]!, rows[glyph]! * SLUG_GLYPH_TABLE_STRIDE * 4, view, record, data.planeUnitsPerEm);
  }
  return { pages, rows };
}

/** Writes one table row from a baked glyph record: the em quad, the band transform, the table bases, the band counts. */
function writeSlugGlyphRow(table: DataView, target: number, records: DataView, record: number, unitsPerEm: number) {
  const left = records.getInt16(record, true) / unitsPerEm;
  const bottom = records.getInt16(record + 2, true) / unitsPerEm;
  const width = records.getInt16(record + 4, true) / unitsPerEm - left;
  const top = records.getInt16(record + 6, true) / unitsPerEm;
  const height = top - bottom;
  const horizontalBands = records.getUint16(record + 10, true);
  const verticalBands = records.getUint16(record + 12, true);
  const bandScaleX = width === 0 ? 0 : verticalBands / width;
  const bandScaleY = height === 0 ? 0 : horizontalBands / height;
  const floats = [left, top, width, height, bandScaleX, bandScaleY, -left * bandScaleX, -bottom * bandScaleY];
  for (const [index, value] of floats.entries()) table.setFloat32(target + index * 4, value, true);
  // Record offset 20 is the curve count, which the table does not need.
  const curveBase = records.getUint32(record + 16, true);
  const horizontalHeaderBase = records.getUint32(record + 24, true);
  const verticalHeaderBase = records.getUint32(record + 28, true);
  const referenceBase = records.getUint32(record + 32, true);
  const entryCount = records.getUint32(record + 36, true);
  const words = [
    curveBase,
    horizontalHeaderBase,
    verticalHeaderBase,
    referenceBase,
    horizontalBands,
    verticalBands,
    entryCount,
  ];
  for (const [index, value] of words.entries()) table.setUint32(target + 32 + index * 4, value, true);
}

function slugPagePayload(page: SlugPageData, glyphs: Uint8Array) {
  return {
    kind: 'group' as const,
    members: {
      headers: {
        kind: 'texture' as const,
        format: 'r32uint' as const,
        width: page.headerWidth,
        height: page.headerHeight,
        bytes: page.headerBytes,
      },
      curves: { kind: 'buffer' as const, bytes: page.curveBytes, stride: 8 },
      references: { kind: 'buffer' as const, bytes: page.referenceBytes, stride: 2 },
      glyphs: { kind: 'buffer' as const, bytes: glyphs, stride: SLUG_GLYPH_TABLE_STRIDE * 4 },
    },
  };
}
