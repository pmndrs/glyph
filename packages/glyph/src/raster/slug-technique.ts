import {
  SLUG_EXTENSION,
  SLUG_FORMAT_VERSION,
  SLUG_GLYPH_RECORD_STRIDE,
  SLUG_KIND,
  SLUG_PLANE_UNITS_PER_EM,
  slugDescriptor,
  type SlugDescriptor,
} from '../internal/slug-contract.js';
import {
  defineRasterTechnique,
  type RasterResourceId,
  type RasterTechnique,
  type RasterTechniqueId,
} from '../raster-technique.js';

export {
  SLUG_DEFAULT_BAND_COUNT,
  SLUG_EXTENSION,
  SLUG_FORMAT_VERSION,
  SLUG_GENERATOR_VERSION,
  SLUG_GLYPH_RECORD_STRIDE,
  SLUG_KIND,
  SLUG_PLANE_UNITS_PER_EM,
  slugDescriptor,
  slugDescriptorRasterKey,
  type SlugDescriptor,
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
export const slug: RasterTechnique<
  RasterTechniqueId & 'pmndrs.slug',
  typeof SLUG_KIND,
  undefined,
  SlugDescriptor,
  SlugData
> = defineRasterTechnique({
  id: 'pmndrs.slug',
  kind: SLUG_KIND,
  extension: SLUG_EXTENSION,
  version: SLUG_FORMAT_VERSION,
  textEffects: [],
  runtimeBaker: () => import('../runtime-bakers/slug.js'),
  descriptor(): SlugDescriptor {
    return slugDescriptor();
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

import { f32, techniqueProgram, u32, type PolicyBufferId, type RasterPlanProgram, id } from '../core.js';
import { registerGlyphRasterPlanProgram } from '../core/raster-plan-program.js';
import { defineTechniqueSchema, type TechniqueSchema } from '../core/technique-schema.js';

const SLUG_RECT_BUFFER_ID: PolicyBufferId = id.buffer('pmndrs.slug/rect');
const SLUG_PLANE_RECT_BUFFER_ID: PolicyBufferId = id.buffer('pmndrs.slug/plane-rect');
const SLUG_BAND_TRANSFORM_BUFFER_ID: PolicyBufferId = id.buffer('pmndrs.slug/band-transform');
const SLUG_COLOR_BUFFER_ID: PolicyBufferId = id.buffer('pmndrs.slug/color');
const SLUG_INVERSE_FONT_SIZE_BUFFER_ID: PolicyBufferId = id.buffer('pmndrs.slug/inverse-font-size');
const SLUG_TABLE_STARTS_BUFFER_ID: PolicyBufferId = id.buffer('pmndrs.slug/table-starts');
const SLUG_BAND_COUNTS_BUFFER_ID: PolicyBufferId = id.buffer('pmndrs.slug/band-counts');

/**
 * The authoritative physical shape of the Slug technique.
 */
export const slugSchema: TechniqueSchema<
  {
    readonly rect: {
      readonly id: typeof SLUG_RECT_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['left', 'top', 'width', 'height'];
    };
    readonly planeRect: {
      readonly id: typeof SLUG_PLANE_RECT_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['left', 'top', 'width', 'height'];
    };
    readonly bandTransform: {
      readonly id: typeof SLUG_BAND_TRANSFORM_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['scaleX', 'scaleY', 'offsetX', 'offsetY'];
    };
    readonly color: {
      readonly id: typeof SLUG_COLOR_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['red', 'green', 'blue', 'alpha'];
    };
    readonly inverseFontSize: {
      readonly id: typeof SLUG_INVERSE_FONT_SIZE_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['inverseFontSize', 'unused1', 'unused2', 'unused3'];
    };
    readonly tableStarts: {
      readonly id: typeof SLUG_TABLE_STARTS_BUFFER_ID;
      readonly scalar: 'u32';
      readonly lanes: readonly ['curveBase', 'horizontalHeaderBase', 'verticalHeaderBase', 'referenceBase'];
    };
    readonly bandCounts: {
      readonly id: typeof SLUG_BAND_COUNTS_BUFFER_ID;
      readonly scalar: 'u32';
      readonly lanes: readonly ['horizontalBands', 'verticalBands', 'unused2', 'unused3'];
    };
  },
  {
    readonly f32: readonly [
      'bearingX',
      'bearingY',
      'width',
      'height',
      'bandScaleX',
      'bandScaleY',
      'bandOffsetX',
      'bandOffsetY',
    ];
    readonly u32: readonly [
      'curveBase',
      'horizontalHeaderBase',
      'verticalHeaderBase',
      'referenceBase',
      'horizontalBands',
      'verticalBands',
    ];
  },
  {
    readonly page: {
      readonly kind: 'group';
      readonly cardinality: 'many';
      readonly members: {
        readonly curves: { readonly kind: 'texture'; readonly format: 'rgba16float' };
        readonly headers: { readonly kind: 'texture'; readonly format: 'r32uint' };
        readonly references: { readonly kind: 'texture'; readonly format: 'r32uint' };
      };
    };
  },
  typeof slug.id
> = defineTechniqueSchema({
  technique: slug.id,
  scope: 'glyph',
  glyphOrigin: { buffer: 'rect' },
  binding: {
    f32: ['bearingX', 'bearingY', 'width', 'height', 'bandScaleX', 'bandScaleY', 'bandOffsetX', 'bandOffsetY'],
    u32: [
      'curveBase',
      'horizontalHeaderBase',
      'verticalHeaderBase',
      'referenceBase',
      'horizontalBands',
      'verticalBands',
    ],
  },
  buffers: {
    rect: { id: SLUG_RECT_BUFFER_ID, scalar: 'f32', lanes: ['left', 'top', 'width', 'height'] },
    planeRect: { id: SLUG_PLANE_RECT_BUFFER_ID, scalar: 'f32', lanes: ['left', 'top', 'width', 'height'] },
    bandTransform: {
      id: SLUG_BAND_TRANSFORM_BUFFER_ID,
      scalar: 'f32',
      lanes: ['scaleX', 'scaleY', 'offsetX', 'offsetY'],
    },
    color: { id: SLUG_COLOR_BUFFER_ID, scalar: 'f32', lanes: ['red', 'green', 'blue', 'alpha'] },
    inverseFontSize: {
      id: SLUG_INVERSE_FONT_SIZE_BUFFER_ID,
      scalar: 'f32',
      lanes: ['inverseFontSize', 'unused1', 'unused2', 'unused3'],
    },
    tableStarts: {
      id: SLUG_TABLE_STARTS_BUFFER_ID,
      scalar: 'u32',
      lanes: ['curveBase', 'horizontalHeaderBase', 'verticalHeaderBase', 'referenceBase'],
    },
    bandCounts: {
      id: SLUG_BAND_COUNTS_BUFFER_ID,
      scalar: 'u32',
      lanes: ['horizontalBands', 'verticalBands', 'unused2', 'unused3'],
    },
  },
  resources: {
    page: {
      kind: 'group',
      cardinality: 'many',
      members: {
        curves: { kind: 'texture', format: 'rgba16float' },
        headers: { kind: 'texture', format: 'r32uint' },
        references: { kind: 'texture', format: 'r32uint' },
      },
    },
  },
  render: { resource: 'page', geometry: { kind: 'synthetic-quad' } },
});

export const slugPlanProgram: RasterPlanProgram<typeof slug, typeof slugSchema> = registerGlyphRasterPlanProgram({
  technique: slug,
  schema: slugSchema,
  policyBody(system) {
    const p = techniqueProgram(slugSchema, { inverseFontSize: true, system });
    const { inlineOrigin, blockOrigin, fontSize, color, inverseFontSize } = p.semantics;
    if (inverseFontSize === undefined) throw new TypeError('the Slug program declares inverseFontSize');
    const {
      bearingX,
      bearingY,
      width,
      height,
      bandScaleX,
      bandScaleY,
      bandOffsetX,
      bandOffsetY,
      curveBase,
      horizontalHeaderBase,
      verticalHeaderBase,
      referenceBase,
      horizontalBands,
      verticalBands,
    } = p.binding;
    const zeroF32 = f32.const(0);
    const zeroU32 = u32.const(0);
    return p.compile({
      rect: [
        f32.add(inlineOrigin, f32.mul(bearingX, fontSize)),
        f32.sub(blockOrigin, f32.mul(bearingY, fontSize)),
        f32.mul(width, fontSize),
        f32.mul(height, fontSize),
      ],
      planeRect: [bearingX, bearingY, width, height],
      bandTransform: [bandScaleX, bandScaleY, bandOffsetX, bandOffsetY],
      color: [color.red, color.green, color.blue, color.alpha],
      inverseFontSize: [inverseFontSize, zeroF32, zeroF32, zeroF32],
      tableStarts: [curveBase, horizontalHeaderBase, verticalHeaderBase, referenceBase],
      bandCounts: [horizontalBands, verticalBands, zeroU32, zeroU32],
    });
  },
  compileFont(compiler) {
    const data = compiler.font.data;
    for (const page of data.pages) compiler.retain('page', page.resource, slugPagePayload(page));
    const view = new DataView(data.records.buffer, data.records.byteOffset);
    const record = (row: number) => row * SLUG_GLYPH_RECORD_STRIDE;
    const page = (row: number) => view.getUint16(record(row) + 8, true);
    const normalized = (row: number, offset: number) =>
      view.getInt16(record(row) + offset, true) / data.planeUnitsPerEm;
    const width = (row: number) => normalized(row, 4) - normalized(row, 0);
    const height = (row: number) => normalized(row, 6) - normalized(row, 2);
    const horizontalBands = (row: number) => view.getUint16(record(row) + 10, true);
    const verticalBands = (row: number) => view.getUint16(record(row) + 12, true);
    const bandScaleX = (row: number) => (width(row) === 0 ? 0 : verticalBands(row) / width(row));
    const bandScaleY = (row: number) => (height(row) === 0 ? 0 : horizontalBands(row) / height(row));
    return compiler.compile({
      strikes: [0],
      resource: (glyph) => {
        const selected = page(glyph);
        return selected === ABSENT_PAGE ? undefined : data.pages[selected]!.resource;
      },
      f32: {
        bearingX: (row) => normalized(row, 0),
        bearingY: (row) => normalized(row, 6),
        width,
        height,
        bandScaleX,
        bandScaleY,
        bandOffsetX: (row) => -normalized(row, 0) * bandScaleX(row),
        bandOffsetY: (row) => -normalized(row, 2) * bandScaleY(row),
      },
      u32: {
        curveBase: (row) => view.getUint32(record(row) + 16, true),
        horizontalHeaderBase: (row) => view.getUint32(record(row) + 24, true),
        verticalHeaderBase: (row) => view.getUint32(record(row) + 28, true),
        referenceBase: (row) => view.getUint32(record(row) + 32, true),
        horizontalBands,
        verticalBands,
      },
    });
  },
});

function slugPagePayload(page: SlugPageData) {
  const references = packSlugReferences(page.referenceBytes, page.referenceWidth);
  return {
    kind: 'group' as const,
    members: {
      curves: {
        kind: 'texture' as const,
        format: 'rgba16float' as const,
        width: page.curveWidth,
        height: page.curveHeight,
        bytes: page.curveBytes,
      },
      headers: {
        kind: 'texture' as const,
        format: 'r32uint' as const,
        width: page.headerWidth,
        height: page.headerHeight,
        bytes: page.headerBytes,
      },
      references: {
        kind: 'texture' as const,
        format: 'r32uint' as const,
        width: references.width,
        height: references.height,
        bytes: new Uint8Array(references.data.buffer),
      },
    },
  };
}

function packSlugReferences(bytes: Uint8Array, preferredWidth: number) {
  const copied = bytes.slice();
  const references = new Uint16Array(copied.buffer, copied.byteOffset, copied.byteLength / 2);
  const texelCount = Math.ceil(references.length / 2);
  const width = Math.min(preferredWidth, texelCount);
  const height = Math.ceil(texelCount / width);
  const data = new Uint32Array(width * height);
  for (let index = 0; index < references.length; index += 1) {
    data[index >> 1] = (data[index >> 1] ?? 0) | (references[index]! << ((index & 1) * 16));
  }
  return { data, width, height };
}
