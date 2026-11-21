import {
  MSDF_EXTENSION,
  MSDF_FORMAT_VERSION,
  MSDF_KIND,
  msdfDescriptor,
  type MsdfDescriptor,
  type MsdfOptions,
} from '../internal/msdf-contract.js';
import { DENSE_GLYPH_RECORD_STRIDE, type RasterAtlasPage } from '../internal/raster-atlas.js';
import {
  defineRasterFormat,
  type RasterResourceId,
  type RasterFormat,
  type RasterFormatId,
} from '../config/raster-format.js';

export {
  MSDF_EM_SIZE,
  MSDF_PIXEL_RANGE,
  type MsdfConfiguration,
  type MsdfDescriptor,
  type MsdfOptions,
} from '../internal/msdf-contract.js';
export { DENSE_GLYPH_RECORD_STRIDE as MSDF_GLYPH_RECORD_STRIDE } from '../internal/raster-atlas.js';

const RECORD_STRIDE = DENSE_GLYPH_RECORD_STRIDE;

export interface MsdfPageData extends RasterAtlasPage {
  readonly format: 'rgba8unorm';
}

export interface MsdfBinding {
  readonly width: number;
  readonly height: number;
  readonly layers: number;
}

export interface MsdfData {
  readonly resource: RasterResourceId;
  readonly binding: MsdfBinding;
  readonly emSize: number;
  readonly pixelRange: number;
  readonly planeUnitsPerEm: number;
  readonly records: Uint8Array;
  readonly coverage?: Uint8Array;
  readonly pages: readonly MsdfPageData[];
}

/** Renderer-neutral MSDF identity, decoding, and ownership. */
export const msdf: RasterFormat<
  RasterFormatId & 'pmndrs.msdf',
  typeof MSDF_KIND,
  MsdfOptions | undefined,
  MsdfDescriptor,
  MsdfData
> = defineRasterFormat({
  id: 'pmndrs.msdf',
  kind: MSDF_KIND,
  extension: MSDF_EXTENSION,
  version: MSDF_FORMAT_VERSION,
  textEffects: ['outline', 'shadow'],
  runtimeBaker: () => import('../runtime-bakers/msdf.js'),
  descriptor(options: MsdfOptions | undefined): MsdfDescriptor {
    return msdfDescriptor(options);
  },
  async decode(font, raster, signal): Promise<MsdfData> {
    signal?.throwIfAborted();
    const { decodeMsdfData } = await import('./internal/msdf-decoder.js');
    const data = await decodeMsdfData(font, raster);
    signal?.throwIfAborted();
    return data;
  },
  dispose(data) {
    releaseMsdfBakedPages(data);
  },
});

import { f32, techniqueProgram, u32 } from '../config/codec-program.js';
import { id, type CodecBufferId } from '../config/codec.js';
import type { RasterCodec } from '../config/raster.js';
import { registerGlyphRasterCodec } from '../internal/raster-codec-registry.js';
import { defineTechniqueSchema, type TechniqueSchema } from '../config/schema.js';

const MSDF_RECT_BUFFER_ID: CodecBufferId = id.buffer('pmndrs.msdf/rect');
const MSDF_COLOR_BUFFER_ID: CodecBufferId = id.buffer('pmndrs.msdf/color');
const MSDF_EFFECT_COLOR_BUFFER_ID: CodecBufferId = id.buffer('pmndrs.msdf/effect-color');
const MSDF_EFFECT_BUFFER_ID: CodecBufferId = id.buffer('pmndrs.msdf/effect');

/** The baked pages of one loaded MSDF font, as its atlas resource names them. */
export interface MsdfBakedPages {
  /** Extent the baked glyph table addresses; pages smaller than it are anchored at its origin. */
  readonly width: number;
  readonly height: number;
  readonly pages: readonly MsdfPageData[];
}

/**
 * Baked pages are megabytes, and a renderer copies only the glyphs it draws out of them. They therefore never enter
 * the portable resource (which owns a copy of every byte it carries): the resource holds a token, and a renderer in
 * this process exchanges it for the decoded pages themselves.
 */
const bakedPagesByToken = new Map<number, MsdfBakedPages>();
const bakedPageTokens = new WeakMap<MsdfData, number>();
let nextBakedPagesToken = 1;

function msdfBakedPagesToken(data: MsdfData): Uint8Array {
  let token = bakedPageTokens.get(data);
  if (token === undefined) {
    token = nextBakedPagesToken;
    nextBakedPagesToken += 1;
    bakedPageTokens.set(data, token);
    bakedPagesByToken.set(token, { width: data.binding.width, height: data.binding.height, pages: data.pages });
  }
  return new Uint8Array(new Uint32Array([token]).buffer);
}

function releaseMsdfBakedPages(data: MsdfData): void {
  const token = bakedPageTokens.get(data);
  if (token !== undefined) bakedPagesByToken.delete(token);
}

/**
 * The baked pages behind an atlas resource's `pages` member. A renderer resolves them when it first realizes the
 * resource and keeps the reference; the font may be disposed afterwards.
 */
export function msdfBakedPages(pages: { readonly bytes: Uint8Array }): MsdfBakedPages {
  const token = new DataView(pages.bytes.buffer, pages.bytes.byteOffset, pages.bytes.byteLength).getUint32(0, true);
  const baked = bakedPagesByToken.get(token);
  if (baked === undefined) throw new Error('MSDF atlas pages were released before a renderer realized them');
  return baked;
}

/** `f32` values per glyph in the atlas `glyphs` table. */
export const MSDF_GLYPH_TABLE_STRIDE = 4;
/** The fourth table value is `height + layer * MSDF_GLYPH_TABLE_LAYER_STEP`; both stay exact in an `f32`. */
export const MSDF_GLYPH_TABLE_LAYER_STEP = 4096;

/**
 * The authoritative physical shape of the MSDF technique.
 *
 * An instance carries what differs between two drawings of one glyph: where it is, how large, and how it is painted.
 * What every drawing of a glyph shares (its atlas cell and layer) lives once per glyph in the atlas `glyphs` table,
 * addressed by the `glyph` lane: `[left, top, width, height + layer * 4096]` in atlas texels. The atlas texels stay
 * in the baked pages, reached through the `pages` token (see `msdfBakedPages`).
 */
export const msdfSchema: TechniqueSchema<
  {
    readonly rect: {
      readonly id: typeof MSDF_RECT_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['left', 'top', 'width', 'height'];
    };
    readonly color: {
      readonly id: typeof MSDF_COLOR_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['red', 'green', 'blue', 'alpha'];
    };
    readonly effectColor: {
      readonly id: typeof MSDF_EFFECT_COLOR_BUFFER_ID;
      readonly scalar: 'u32';
      readonly lanes: readonly ['outline', 'shadow'];
    };
    readonly effect: {
      readonly id: typeof MSDF_EFFECT_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['shadowX', 'shadowY', 'outlineWidth', 'glyph'];
    };
  },
  {
    readonly f32: readonly ['bearingX', 'bearingY', 'width', 'height'];
    readonly u32: readonly ['glyph'];
  },
  {
    readonly atlas: {
      readonly kind: 'group';
      readonly members: {
        readonly pages: { readonly kind: 'buffer' };
        readonly pixelRange: { readonly kind: 'buffer' };
        readonly effectScale: { readonly kind: 'buffer' };
        readonly glyphs: { readonly kind: 'buffer' };
      };
    };
  },
  typeof msdf.id
> = defineTechniqueSchema({
  technique: msdf.id,
  scope: 'glyph',
  glyphOrigin: { buffer: 'rect' },
  binding: {
    f32: ['bearingX', 'bearingY', 'width', 'height'],
    u32: ['glyph'],
  },
  buffers: {
    rect: { id: MSDF_RECT_BUFFER_ID, scalar: 'f32', lanes: ['left', 'top', 'width', 'height'] },
    color: { id: MSDF_COLOR_BUFFER_ID, scalar: 'f32', lanes: ['red', 'green', 'blue', 'alpha'] },
    effectColor: { id: MSDF_EFFECT_COLOR_BUFFER_ID, scalar: 'u32', lanes: ['outline', 'shadow'] },
    effect: { id: MSDF_EFFECT_BUFFER_ID, scalar: 'f32', lanes: ['shadowX', 'shadowY', 'outlineWidth', 'glyph'] },
  },
  resources: {
    atlas: {
      kind: 'group',
      members: {
        pages: { kind: 'buffer' },
        pixelRange: { kind: 'buffer' },
        effectScale: { kind: 'buffer' },
        glyphs: { kind: 'buffer' },
      },
    },
  },
  render: { resource: 'atlas', geometry: { kind: 'synthetic-quad' } },
});

export const msdfCodec: RasterCodec<typeof msdf, typeof msdfSchema> = registerGlyphRasterCodec({
  raster: msdf,
  schema: msdfSchema,
  codecBody() {
    const p = techniqueProgram(msdfSchema, { textEffects: msdf.textEffects });
    const { inlineOrigin, blockOrigin, fontSize, color, outline, shadow } = p.semantics;
    if (outline === undefined || shadow === undefined) {
      throw new Error('MSDF text effects are not configured');
    }
    const { bearingX, bearingY, width, height, glyph } = p.binding;
    return p.compile({
      rect: [
        f32.add(inlineOrigin, f32.mul(bearingX, fontSize)),
        f32.sub(blockOrigin, f32.mul(bearingY, fontSize)),
        f32.mul(width, fontSize),
        f32.mul(height, fontSize),
      ],
      color: [color.red, color.green, color.blue, color.alpha],
      effectColor: [outline.color, shadow.color],
      effect: [shadow.offsetXEm, shadow.offsetYEm, outline.widthEm, u32.toF32(glyph)],
    });
  },
  compileFont(compiler) {
    const data = compiler.font.data;
    const view = new DataView(data.records.buffer, data.records.byteOffset);
    compiler.retain('atlas', data.resource, {
      kind: 'group',
      members: {
        pages: { kind: 'buffer', bytes: msdfBakedPagesToken(data), stride: 4 },
        pixelRange: { kind: 'buffer', bytes: portableF32(data.pixelRange), stride: 4 },
        effectScale: {
          kind: 'buffer',
          bytes: portableF32x3(
            data.planeUnitsPerEm / data.binding.width,
            data.planeUnitsPerEm / data.binding.height,
            data.planeUnitsPerEm / data.pixelRange,
          ),
          stride: 12,
        },
        glyphs: { kind: 'buffer', bytes: msdfGlyphTable(data), stride: MSDF_GLYPH_TABLE_STRIDE * 4 },
      },
    });
    const record = (row: number) => row * RECORD_STRIDE;
    const page = (row: number) => view.getUint16(record(row) + 16, true);
    return compiler.compile({
      strikes: [0],
      resource: (glyph) => (page(glyph) === 0xffff ? undefined : data.resource),
      f32: {
        bearingX: (row) => view.getInt16(record(row), true) / data.planeUnitsPerEm,
        bearingY: (row) => view.getInt16(record(row) + 6, true) / data.planeUnitsPerEm,
        width: (row) =>
          (view.getInt16(record(row) + 4, true) - view.getInt16(record(row), true)) / data.planeUnitsPerEm,
        height: (row) =>
          (view.getInt16(record(row) + 6, true) - view.getInt16(record(row) + 2, true)) / data.planeUnitsPerEm,
      },
      u32: { glyph: (row) => row },
    });
  },
});

/** One row per baked glyph record: its atlas cell in texels and its layer; an absent glyph is an empty cell. */
function msdfGlyphTable(data: MsdfData): Uint8Array {
  const view = new DataView(data.records.buffer, data.records.byteOffset, data.records.byteLength);
  const rows = data.records.byteLength / RECORD_STRIDE;
  const bytes = new Uint8Array(rows * MSDF_GLYPH_TABLE_STRIDE * 4);
  const table = new DataView(bytes.buffer);
  for (let row = 0; row < rows; row += 1) {
    const record = row * RECORD_STRIDE;
    const page = view.getUint16(record + 16, true);
    if (page === 0xffff) continue;
    const left = view.getUint16(record + 8, true);
    const top = view.getUint16(record + 10, true);
    const target = row * MSDF_GLYPH_TABLE_STRIDE * 4;
    table.setFloat32(target, left, true);
    table.setFloat32(target + 4, top, true);
    table.setFloat32(target + 8, view.getUint16(record + 12, true) - left, true);
    table.setFloat32(target + 12, view.getUint16(record + 14, true) - top + page * MSDF_GLYPH_TABLE_LAYER_STEP, true);
  }
  return bytes;
}

function portableF32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setFloat32(0, value, true);
  return bytes;
}

function portableF32x3(x: number, y: number, z: number): Uint8Array {
  const bytes = new Uint8Array(12);
  const view = new DataView(bytes.buffer);
  view.setFloat32(0, x, true);
  view.setFloat32(4, y, true);
  view.setFloat32(8, z, true);
  return bytes;
}
