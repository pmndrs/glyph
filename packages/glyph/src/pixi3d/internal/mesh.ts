import type { BaseMaterial3D, ShaderBit } from '@pixi/3d';
import { Box, FlatMaterial, Geometry3D, Mesh3D } from '@pixi/3d';
import type { CodecBufferId } from '../../index.js';
import { decorationSchema } from '../../config/decoration.js';
import { MSDF_GLYPH_TABLE_LAYER_STEP, MSDF_GLYPH_TABLE_STRIDE } from '../../raster/msdf.js';
import { SLUG_GLYPH_TABLE_STRIDE } from '../../raster/slug.js';
import type { Texture } from 'pixi.js';
import { Buffer, BufferUsage } from 'pixi.js';

import type { Pixi3DBufferBinding } from './bindings.js';
import { glyphBitmapBit } from '../bitmap-bit.js';
import {
  pixi3dBitmapBuffers,
  pixi3dGlyphFactBuffers,
  pixi3dMsdfBuffers,
  pixi3dSlugBuffers,
  pixi3dSystemBuffers,
} from './codec.js';
import { glyphDecorationBit } from './decoration-bit.js';
import {
  createPixi3DTextMaterial,
  detachPixi3DTextMaterial,
  type Pixi3DTextMaterial,
  type Pixi3DTextMaterialFormat,
} from '../material.js';
import { Pixi3DMeshPool, releasePooledMesh } from './mesh-pool.js';
import { glyphMsdfBit } from '../msdf-bit.js';
import {
  createNativeGlyphMesh,
  glyphSeed,
  nativeGlyphBit,
  nativeGlyphBitsSupported,
  type NativeGlyphField,
} from './native-record.js';
import type {
  Pixi3DBitmapResource,
  Pixi3DMsdfResource,
  Pixi3DResolvedResource,
  Pixi3DSlugResource,
} from './resource.js';
import { createGlyphSlugBits } from '../slug-bit.js';

export interface RetainedPixi3DBuffer {
  readonly binding: Pixi3DBufferBinding;
  readonly scalarType: 'f32' | 'u32' | 'u16';
  readonly vectorWidth: number;
  readonly bytes: Uint8Array;
}

/** The lanes one draw span reads, and the session placement table its placement slots index. */
interface SpanLanes {
  readonly bindings: readonly Pixi3DBufferBinding[];
  readonly retained: ReadonlyMap<Pixi3DBufferBinding, RetainedPixi3DBuffer>;
  readonly placementTable: RetainedPixi3DBuffer;
  readonly placementSlot: RetainedPixi3DBuffer;
}

type Quad = readonly [number, number, number, number];

/** One glyph instance: its per-record shader inputs, its placed quad in paragraph space, and its span ordinal. */
interface GlyphRecord {
  readonly fields: readonly NativeGlyphField[];
  readonly quad: Quad;
  readonly ordinal: number;
}

/** What every mesh of one atlas page needs besides its records. */
interface PageDraw {
  readonly format: Pixi3DTextMaterialFormat;
  /** Shared material identity: compatible draws of the same page lease one material. */
  readonly scope: object;
  readonly textures: Readonly<Record<string, Texture>>;
  /** The ordered bits for a recipe's extension bits, raster bits around them. */
  bits(extraBits: readonly ShaderBit[]): ShaderBit[];
  configure?(material: BaseMaterial3D): void;
}

export function createRasterMeshes(
  resource: Pixi3DResolvedResource,
  bindings: readonly Pixi3DBufferBinding[],
  retained: ReadonlyMap<Pixi3DBufferBinding, RetainedPixi3DBuffer>,
  placementTable: RetainedPixi3DBuffer,
  recordIndex: number,
  recordCount: number,
  material: Pixi3DTextMaterial | undefined,
  pool: Pixi3DMeshPool,
): Mesh3D[] {
  if (placementTable.scalarType !== 'f32' || placementTable.vectorWidth !== 2) {
    throw new TypeError('Pixi3D placement table must contain f32x2 records');
  }
  const lanes: SpanLanes = {
    bindings,
    retained,
    placementTable,
    placementSlot: codecBuffer(bindings, retained, pixi3dSystemBuffers.placementSlot.id, 'u32', 1, 'placementSlot'),
  };
  const pages =
    resource.format === 'pmndrs.bitmap'
      ? bitmapRecords(resource.bitmap, lanes, recordIndex, recordCount)
      : resource.format === 'pmndrs.msdf'
        ? msdfRecords(resource.msdf, lanes, recordIndex, recordCount)
        : slugRecords(resource.slug, lanes, recordIndex, recordCount);
  if (material?.extraBits.some((bit) => bit.attributes?.aGlyphFacts !== undefined) === true) {
    appendGlyphFacts(pages, lanes, recordIndex);
  }
  const meshes: Mesh3D[] = [];
  try {
    for (const [draw, records] of pages) meshes.push(realizePage(draw, records, material, pool));
    return meshes;
  } catch (error) {
    destroyBitmapMeshes(meshes);
    throw error;
  }
}

/**
 * Gives every record the `aGlyphFacts` field a recipe's bits declared: the pen origin in the paragraph space of the
 * vertex position (+Y up), then the layout index. Only such a recipe reads the lane or carries the field.
 */
function appendGlyphFacts(pages: Map<PageDraw, GlyphRecord[]>, lanes: SpanLanes, recordIndex: number): void {
  if (
    !lanes.bindings.some(
      ({ input }) =>
        input.declaration.kind === 'codec' && input.declaration.value.id === pixi3dGlyphFactBuffers.glyphFacts.id,
    )
  ) {
    throw new TypeError(
      'Pixi3D text material declares aGlyphFacts, which its handle does not publish; create the handle with definePixi3DConfig({ glyphFacts: true })',
    );
  }
  const facts = lane(lanes, pixi3dGlyphFactBuffers.glyphFacts.id, 'f32', 4, 'glyphFacts');
  for (const records of pages.values()) {
    for (const [position, record] of records.entries()) {
      const index = recordIndex + record.ordinal;
      const [originX, originY, glyphIndex] = f32x(facts.bytes, index, 4);
      const [x, y] = placedOrigin(lanes, index, [originX, originY]);
      records[position] = {
        ...record,
        fields: [...record.fields, { name: 'aGlyphFacts', type: 'float32x4', value: [x, -y, glyphIndex, 0] }],
      };
    }
  }
}

export function destroyBitmapMeshes(meshes: Iterable<Mesh3D>): void {
  for (const mesh of meshes) {
    if (releasePooledMesh(mesh)) continue;
    detachPixi3DTextMaterial(mesh.material);
    mesh.destroy({ geometry: true, material: true });
  }
}

function bitmapRecords(
  atlas: Pixi3DBitmapResource,
  lanes: SpanLanes,
  recordIndex: number,
  recordCount: number,
): Map<PageDraw, GlyphRecord[]> {
  const origin = lane(lanes, pixi3dBitmapBuffers.origin.id, 'f32', 2, 'origin');
  const size = lane(lanes, pixi3dBitmapBuffers.size.id, 'f32', 2, 'size');
  const uvOrigin = lane(lanes, pixi3dBitmapBuffers.uvOrigin.id, 'f32', 2, 'uvOrigin');
  const uvSize = lane(lanes, pixi3dBitmapBuffers.uvSize.id, 'f32', 2, 'uvSize');
  const color = lane(lanes, pixi3dBitmapBuffers.color.id, 'f32', 4, 'color');
  const page = lane(lanes, pixi3dBitmapBuffers.page.id, 'u32', 1, 'page');
  return groupByPage(recordCount, (offset) => {
    const index = recordIndex + offset;
    const layer = u32(page.bytes, index);
    if (layer >= atlas.pages.length) throw new RangeError(`Pixi3D Bitmap page ${layer} is out of range`);
    const placed = placedOrigin(lanes, index, f32x(origin.bytes, index, 2));
    const extent = f32x(size.bytes, index, 2);
    return [
      bitmapPage(atlas, layer),
      {
        fields: [
          { name: 'aGlyphOrigin', type: 'float32x2', value: placed },
          { name: 'aGlyphSize', type: 'float32x2', value: extent },
          { name: 'aGlyphUvOrigin', type: 'float32x2', value: f32x(uvOrigin.bytes, index, 2) },
          { name: 'aGlyphUvSize', type: 'float32x2', value: f32x(uvSize.bytes, index, 2) },
          { name: 'aGlyphColor', type: 'float32x4', value: f32x(color.bytes, index, 4) },
        ],
        quad: [placed[0], placed[1], extent[0], extent[1]],
        ordinal: offset,
      },
    ];
  });
}

function msdfRecords(
  atlas: Pixi3DMsdfResource,
  lanes: SpanLanes,
  recordIndex: number,
  recordCount: number,
): Map<PageDraw, GlyphRecord[]> {
  const rect = lane(lanes, pixi3dMsdfBuffers.rect.id, 'f32', 4, 'rect');
  const color = lane(lanes, pixi3dMsdfBuffers.color.id, 'f32', 4, 'color');
  const effectColor = lane(lanes, pixi3dMsdfBuffers.effectColor.id, 'u32', 2, 'effectColor');
  const effect = lane(lanes, pixi3dMsdfBuffers.effect.id, 'f32', 4, 'effect');
  const [atlasWidth, atlasHeight] = atlas.atlasSize;
  return groupByPage(recordCount, (offset) => {
    const index = recordIndex + offset;
    const [shadowX, shadowY, outlineWidth, glyph] = f32x(effect.bytes, index, 4);
    // The glyph's atlas cell, shared by every drawing of it: `[left, top, width, height + layer * 4096]` in texels.
    const row = glyph * MSDF_GLYPH_TABLE_STRIDE;
    const [left, top, width, packedHeight] = atlas.glyphs.subarray(row, row + MSDF_GLYPH_TABLE_STRIDE);
    const layer = Math.floor(packedHeight! / MSDF_GLYPH_TABLE_LAYER_STEP);
    const height = packedHeight! - layer * MSDF_GLYPH_TABLE_LAYER_STEP;
    if (layer >= atlas.pages.length) throw new RangeError(`Pixi3D MTSDF page ${layer} is out of range`);
    const quad = placedRect(lanes, index, f32x(rect.bytes, index, 4));
    const u = left! / atlasWidth;
    const v = top! / atlasHeight;
    return [
      msdfPage(atlas, layer),
      {
        fields: [
          { name: 'aGlyphRect', type: 'float32x4', value: quad },
          { name: 'aGlyphUvRect', type: 'float32x4', value: [u, v, width! / atlasWidth, height / atlasHeight] },
          {
            name: 'aGlyphUvBounds',
            type: 'float32x4',
            value: [u, v, (left! + width!) / atlasWidth, (top! + height) / atlasHeight],
          },
          { name: 'aGlyphColor', type: 'float32x4', value: f32x(color.bytes, index, 4) },
          { name: 'aGlyphEffectColor', type: 'uint32x2', value: u32x(effectColor.bytes, index, 2) },
          { name: 'aGlyphPage', type: 'float32x4', value: [shadowX, shadowY, outlineWidth, layer] },
        ],
        quad,
        ordinal: offset,
      },
    ];
  });
}

function slugRecords(
  page: Pixi3DSlugResource,
  lanes: SpanLanes,
  recordIndex: number,
  recordCount: number,
): Map<PageDraw, GlyphRecord[]> {
  const rect = lane(lanes, pixi3dSlugBuffers.rect.id, 'f32', 4, 'rect');
  const color = lane(lanes, pixi3dSlugBuffers.color.id, 'f32', 4, 'color');
  const glyph = lane(lanes, pixi3dSlugBuffers.glyph.id, 'u32', 2, 'glyph');
  // Resident before any row is read: admission points each new glyph's `referenceBase` at its band entries.
  const rows = new Uint32Array(glyph.bytes.buffer, glyph.bytes.byteOffset, glyph.bytes.byteLength >>> 2);
  page.use(rows, recordIndex, recordIndex + recordCount);
  const table = page.table;
  const floats = new Float32Array(table.buffer, table.byteOffset, table.length);
  const draw = slugPage(page);
  return groupByPage(recordCount, (offset) => {
    const index = recordIndex + offset;
    const start = rows[index * 2]! * SLUG_GLYPH_TABLE_STRIDE;
    const quad = placedRect(lanes, index, f32x(rect.bytes, index, 4));
    return [
      draw,
      {
        fields: [
          { name: 'aGlyphRect', type: 'float32x4', value: quad },
          { name: 'aGlyphPlaneRect', type: 'float32x4', value: Array.from(floats.subarray(start, start + 4)) },
          { name: 'aGlyphBandTransform', type: 'float32x4', value: Array.from(floats.subarray(start + 4, start + 8)) },
          { name: 'aGlyphColor', type: 'float32x4', value: f32x(color.bytes, index, 4) },
          { name: 'aGlyphTableStarts', type: 'uint32x4', value: Array.from(table.subarray(start + 8, start + 12)) },
          { name: 'aGlyphBandCounts', type: 'uint32x4', value: Array.from(table.subarray(start + 12, start + 16)) },
        ],
        quad,
        ordinal: offset,
      },
    ];
  });
}

const bitmapPages = new WeakMap<Pixi3DBitmapResource, PageDraw[]>();
const msdfPages = new WeakMap<Pixi3DMsdfResource, PageDraw[]>();
const slugPages = new WeakMap<Pixi3DSlugResource, PageDraw>();

function bitmapPage(atlas: Pixi3DBitmapResource, layer: number): PageDraw {
  const pages = bitmapPages.get(atlas) ?? [];
  bitmapPages.set(atlas, pages);
  pages[layer] ??= {
    format: 'pmndrs.bitmap',
    scope: atlas.pages[layer]!,
    textures: { glyphBitmapAtlas: atlas.pages[layer]! },
    bits: (extraBits) => [glyphBitmapBit, ...extraBits],
  };
  return pages[layer];
}

function msdfPage(atlas: Pixi3DMsdfResource, layer: number): PageDraw {
  const pages = msdfPages.get(atlas) ?? [];
  msdfPages.set(atlas, pages);
  pages[layer] ??= {
    format: 'pmndrs.msdf',
    scope: atlas.pages[layer]!,
    textures: { glyphMsdfAtlas: atlas.pages[layer]! },
    bits: (extraBits) => [glyphMsdfBit, ...extraBits],
    configure(material) {
      material.data.uGlyphAtlasSize = Float32Array.from(atlas.atlasSize);
      material.data.uGlyphPixelRange = atlas.pixelRange;
      material.data.uGlyphEffectScale = Float32Array.from(atlas.effectScale);
    },
  };
  return pages[layer];
}

function slugPage(page: Pixi3DSlugResource): PageDraw {
  let draw = slugPages.get(page);
  if (draw === undefined) {
    draw = {
      format: 'pmndrs.slug',
      scope: page,
      textures: { glyphSlugHeaders: page.headers, glyphSlugBandCurves: page.bandCurves },
      bits: (extraBits) => {
        const { setup, coverage } = createGlyphSlugBits(page);
        return [setup, ...extraBits, coverage];
      },
    };
    slugPages.set(page, draw);
  }
  return draw;
}

/**
 * One mesh for the records of one page. A lone first record of its span becomes a native material row on the shared
 * canonical quad when the recipe allows it; anything else gets expanded per-vertex attributes.
 */
function realizePage(
  draw: PageDraw,
  records: readonly GlyphRecord[],
  extension: Pixi3DTextMaterial | undefined,
  pool: Pixi3DMeshPool,
): Mesh3D {
  const extraBits = extension?.extraBits ?? [];
  const material = (bits: ShaderBit[]): BaseMaterial3D => {
    const created = createPixi3DTextMaterial(extension, draw.format, bits, draw.textures);
    draw.configure?.(created);
    return created;
  };
  const bounds = new Box();
  for (const { quad } of records) expandQuad(bounds, quad);
  if (
    records.length === 1 &&
    records[0]!.ordinal === 0 &&
    extension?.nativeRecords !== false &&
    nativeGlyphBitsSupported(extraBits)
  ) {
    return createNativeGlyphMesh(
      records[0]!.fields,
      bounds,
      () => material(draw.bits(extraBits).map(nativeGlyphBit)),
      pool,
    );
  }
  const geometry = expandedGeometry(records, bounds);
  return createMesh(
    geometry,
    () => pool.material(draw.scope, extension, draw.format, () => material(draw.bits(extraBits))),
    pool,
  );
}

const CORNERS = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
] as const;

/** Four vertices per record, each repeating the record's fields, plus the unit corner, its UV and the effect seed. */
function expandedGeometry(records: readonly GlyphRecord[], bounds3D: Box): Geometry3D {
  const vertexCount = records.length * 4;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const effects = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(records.length * 6);
  const columns = records[0]!.fields.map(({ name, type }) => {
    const width = Number(type.at(-1));
    const data = type.startsWith('uint') ? new Uint32Array(vertexCount * width) : new Float32Array(vertexCount * width);
    return { name, type, width, data };
  });
  for (const [glyph, record] of records.entries()) {
    const base = glyph * 4;
    for (const [corner, unit] of CORNERS.entries()) {
      const vertex = base + corner;
      positions.set([unit[0], unit[1], 0], vertex * 3);
      uvs.set(unit, vertex * 2);
      effects.set([record.ordinal, glyphSeed(record.ordinal)], vertex * 2);
      for (const [field, column] of columns.entries())
        column.data.set(record.fields[field]!.value, vertex * column.width);
    }
    indices.set([base, base + 1, base + 2, base, base + 2, base + 3], glyph * 6);
  }
  const attributes: Record<string, ReturnType<typeof attribute>> = {
    aPosition: attribute(positions, 'float32x3', 'position'),
    aUV: attribute(uvs, 'float32x2', 'uv'),
    aGlyphEffect: attribute(effects, 'float32x2', 'glyph-effect'),
  };
  for (const { name, type, data } of columns) attributes[name] = attribute(data, type, name);
  return new Geometry3D({ bounds3D, attributes, indices });
}

function attribute(data: Float32Array | Uint32Array, format: NativeGlyphField['type'] | 'float32x3', label: string) {
  return {
    buffer: new Buffer({ data, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST, label: `glyph-${label}` }),
    format,
    // Pixi's geometry atlas counts vertices from the stride; a format alone yields NaN.
    stride: Number(format.at(-1)) * 4,
    offset: 0,
  };
}

/** Groups a span's records by the page they draw from, in span order. */
function groupByPage(
  recordCount: number,
  record: (offset: number) => readonly [PageDraw, GlyphRecord],
): Map<PageDraw, GlyphRecord[]> {
  const pages = new Map<PageDraw, GlyphRecord[]>();
  for (let offset = 0; offset < recordCount; offset += 1) {
    const [page, value] = record(offset);
    const records = pages.get(page) ?? [];
    records.push(value);
    pages.set(page, records);
  }
  return pages;
}

function placement(lanes: SpanLanes, index: number): [number, number] {
  return f32x(lanes.placementTable.bytes, u32(lanes.placementSlot.bytes, index), 2);
}

function placedOrigin(lanes: SpanLanes, index: number, origin: readonly [number, number]): [number, number] {
  const [x, y] = placement(lanes, index);
  return [origin[0] + x, origin[1] + y];
}

function placedRect(lanes: SpanLanes, index: number, rect: Quad): [number, number, number, number] {
  const [x, y] = placedOrigin(lanes, index, [rect[0], rect[1]]);
  return [x, y, rect[2], rect[3]];
}

function lane(
  lanes: SpanLanes,
  id: CodecBufferId,
  scalarType: 'f32' | 'u32',
  vectorWidth: number,
  name: string,
): RetainedPixi3DBuffer {
  return codecBuffer(lanes.bindings, lanes.retained, id, scalarType, vectorWidth, name);
}

function codecBuffer(
  bindings: readonly Pixi3DBufferBinding[],
  retained: ReadonlyMap<Pixi3DBufferBinding, RetainedPixi3DBuffer>,
  id: CodecBufferId,
  scalarType: 'f32' | 'u32',
  vectorWidth: number,
  name: string,
): RetainedPixi3DBuffer {
  const binding = bindings.find(
    (candidate) => candidate.input.declaration.kind === 'codec' && candidate.input.declaration.value.id === id,
  );
  const result = binding === undefined ? undefined : retained.get(binding);
  if (result === undefined) throw new Error(`Pixi3D draw is missing its ${name} buffer`);
  if (result.scalarType !== scalarType || result.vectorWidth !== vectorWidth) {
    throw new TypeError(`Pixi3D ${name} buffer must contain ${scalarType}x${vectorWidth} records`);
  }
  return result;
}

function f32x(bytes: Uint8Array, index: number, width: 2): [number, number];
function f32x(bytes: Uint8Array, index: number, width: 4): [number, number, number, number];
function f32x(bytes: Uint8Array, index: number, width: 2 | 4): number[] {
  return words(bytes, index, width, (view, offset) => view.getFloat32(offset, true));
}

function u32x(bytes: Uint8Array, index: number, width: 2): number[] {
  return words(bytes, index, width, (view, offset) => view.getUint32(offset, true));
}

function u32(bytes: Uint8Array, index: number): number {
  return words(bytes, index, 1, (view, offset) => view.getUint32(offset, true))[0]!;
}

/** Record `index` of a lane holding `width` 32-bit words per record. */
function words(
  bytes: Uint8Array,
  index: number,
  width: number,
  read: (view: DataView, offset: number) => number,
): number[] {
  const start = index * width * 4;
  if (start + width * 4 > bytes.byteLength) throw new RangeError('Pixi3D Codec record is out of range');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: width }, (_, laneIndex) => read(view, start + laneIndex * 4));
}

function createMesh(geometry: Geometry3D, createMaterial: () => BaseMaterial3D, pool: Pixi3DMeshPool): Mesh3D {
  let material: BaseMaterial3D;
  try {
    material = createMaterial();
  } catch (error) {
    geometry.destroy(true);
    throw error;
  }
  const mesh = new Mesh3D({ geometry: pool.geometry(geometry), material, castShadow: false, receiveShadow: false });
  pool.own(mesh);
  return mesh;
}

function expandQuad(box: Box, [x, y, width, height]: Quad): void {
  box.expandByPoint({ x, y: -y, z: 0 });
  box.expandByPoint({ x: x + width, y: -y - height, z: 0 });
}

const decorationMaterialScope = {};

export function createDecorationMeshes(
  bindings: readonly Pixi3DBufferBinding[],
  retained: ReadonlyMap<Pixi3DBufferBinding, RetainedPixi3DBuffer>,
  recordIndex: number,
  recordCount: number,
  pool: Pixi3DMeshPool,
): Mesh3D[] {
  const rect = codecBuffer(bindings, retained, decorationSchema.buffers.rect.id, 'f32', 4, 'decoration rect');
  const packed = codecBuffer(bindings, retained, decorationSchema.buffers.packed.id, 'u32', 2, 'decoration paint');
  const positions = new Float32Array(recordCount * 12);
  const paints = new Uint32Array(recordCount * 8);
  const indices = new Uint32Array(recordCount * 6);
  const bounds3D = new Box();
  for (let i = 0; i < recordCount; i++) {
    const index = recordIndex + i;
    const box = f32x(rect.bytes, index, 4);
    const paint = u32x(packed.bytes, index, 2);
    for (const [j, corner] of CORNERS.entries()) {
      positions.set([box[0] + corner[0] * box[2], -(box[1] + corner[1] * box[3]), 0], (i * 4 + j) * 3);
      paints.set(paint, (i * 4 + j) * 2);
    }
    const base = i * 4;
    indices.set([base, base + 1, base + 2, base, base + 2, base + 3], i * 6);
    expandQuad(bounds3D, box);
  }
  const geometry = new Geometry3D({
    bounds3D,
    indices,
    attributes: {
      aPosition: attribute(positions, 'float32x3', 'decoration-position'),
      aGlyphDecoration: attribute(paints, 'uint32x2', 'decoration-paint'),
    },
  });
  return [
    createMesh(
      geometry,
      () =>
        pool.material(decorationMaterialScope, undefined, 'pmndrs.bitmap', () => {
          const material = new FlatMaterial({
            alphaMode: 'blend',
            doubleSided: true,
            fog: false,
            extraBits: [glyphDecorationBit],
          });
          // Decoration paint is linear like glyph paint, and the default text material encodes linear light for
          // display; FlatMaterial's own default (`'display'`) would write the linear value unencoded, too dark.
          material.colorSpace = 'linear';
          return material;
        }),
      pool,
    ),
  ];
}
