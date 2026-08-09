import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type { LoadedFont } from '../loaded-font.js';
import { bitmap, type BitmapData } from '../raster/bitmap-technique.js';
import { msdf, type MsdfData } from '../raster/msdf.js';
import { slug, type SlugData } from '../raster/slug-technique.js';
import type { AnyRasterTechnique, RasterResourceId } from '../raster-technique.js';
import { RenderWireIdentityRegistry, type FirstPartyTechniqueWireIds } from './render-policy-wire.js';

const MAX_U32 = 0xffff_ffff;
const ABSENT_PAGE = 0xffff;
const MISSING_RESOURCE = 0xffff_ffff;

export interface BindingResource {
  readonly key: RasterResourceId;
  readonly id: number;
  readonly generation: number;
  readonly kind: number;
  readonly reference: number;
}

export interface FontBindingFieldTable {
  readonly rows: number;
  readonly fields: readonly ((row: number) => number)[];
}

export interface FontBindingDescriptor {
  readonly techniqueId: number;
  readonly programVariant: number;
  readonly glyphCount: number;
  readonly strikes: readonly number[];
  readonly resources: readonly BindingResource[];
  readonly resourceIndex: (row: number) => number;
  readonly glyphF32: FontBindingFieldTable;
  readonly glyphU32: FontBindingFieldTable;
  readonly strikeF32: FontBindingFieldTable;
  readonly strikeU32: FontBindingFieldTable;
  readonly resourceF32: FontBindingFieldTable;
  readonly resourceU32: FontBindingFieldTable;
}

/** Compile one first-party loaded font into the Rust engine's field-major immutable binding. */
export function firstPartyFontBindingBytes(
  font: LoadedFont<AnyRasterTechnique>,
  identities: RenderWireIdentityRegistry = new RenderWireIdentityRegistry(),
): Uint8Array {
  const techniqueIds: FirstPartyTechniqueWireIds = {
    bitmap: identities.resolve(bitmap.id),
    msdf: identities.resolve(msdf.id),
    slug: identities.resolve(slug.id),
  };
  if (font.technique.id === bitmap.id && isBitmapData(font.data)) {
    return compileBitmap(font.font.glyphCount, font.data, techniqueIds.bitmap, identities);
  }
  if (font.technique.id === msdf.id && isMsdfData(font.data)) {
    return compileMsdf(font.font.glyphCount, font.data, techniqueIds.msdf, identities);
  }
  if (font.technique.id === slug.id && isSlugData(font.data)) {
    return compileSlug(font.font.glyphCount, font.data, techniqueIds.slug, identities);
  }
  throw new TypeError(`no first-party font-binding compiler is registered for "${font.technique.id}"`);
}

function isBitmapData(value: unknown): value is BitmapData {
  return (
    isRecord(value) &&
    Array.isArray(value.strikes) &&
    value.strikes.length !== 0 &&
    value.strikes.every(
      (strike) =>
        isRecord(strike) &&
        Number.isSafeInteger(strike.ppem) &&
        Number.isSafeInteger(strike.planeUnitsPerEm) &&
        strike.records instanceof Uint8Array &&
        Array.isArray(strike.pages),
    )
  );
}

function isMsdfData(value: unknown): value is MsdfData {
  return (
    isRecord(value) &&
    typeof value.resource === 'string' &&
    Number.isSafeInteger(value.planeUnitsPerEm) &&
    value.records instanceof Uint8Array &&
    Array.isArray(value.pages)
  );
}

function isSlugData(value: unknown): value is SlugData {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.planeUnitsPerEm) &&
    value.records instanceof Uint8Array &&
    Array.isArray(value.pages)
  );
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

function compileBitmap(
  glyphCount: number,
  data: BitmapData,
  techniqueId: number,
  identities: RenderWireIdentityRegistry,
): Uint8Array {
  const entries = data.strikes.flatMap((strike) => strike.pages.map((page) => page.resource));
  const { resources, indexFor } = fontBindingResources(entries, identities);
  const views = data.strikes.map((strike) => recordView(strike.records));
  const rows = checkedProduct(glyphCount, data.strikes.length, 'bitmap strike rows');
  const strikeRecord = (row: number): { readonly view: DataView; readonly record: number; readonly strike: number } => {
    const strike = Math.floor(row / glyphCount);
    return { view: views[strike]!, record: (row % glyphCount) * 20, strike };
  };
  const atlas = (row: number, offset: number, dimension: 'width' | 'height'): number => {
    const { view, record, strike } = strikeRecord(row);
    const page = view.getUint16(record + 16, true);
    return page === ABSENT_PAGE
      ? 0
      : view.getUint16(record + offset, true) / data.strikes[strike]!.pages[page]![dimension];
  };
  const span = (row: number, start: number, end: number, dimension: 'width' | 'height'): number => {
    const { view, record, strike } = strikeRecord(row);
    const page = view.getUint16(record + 16, true);
    return page === ABSENT_PAGE
      ? 0
      : (view.getUint16(record + end, true) - view.getUint16(record + start, true)) /
          data.strikes[strike]!.pages[page]![dimension];
  };
  return compileFontBinding({
    techniqueId,
    programVariant: 0,
    glyphCount,
    strikes: data.strikes.map((strike) => strike.ppem),
    resources,
    resourceIndex(row) {
      const { view, record, strike } = strikeRecord(row);
      const page = view.getUint16(record + 16, true);
      return page === ABSENT_PAGE ? MISSING_RESOURCE : indexFor(data.strikes[strike]!.pages[page]!.resource);
    },
    glyphF32: emptyFontBindingTable(glyphCount),
    glyphU32: emptyFontBindingTable(glyphCount),
    strikeF32: {
      rows,
      fields: [
        (row) => {
          const { view, record, strike } = strikeRecord(row);
          return view.getInt16(record, true) / data.strikes[strike]!.planeUnitsPerEm;
        },
        (row) => {
          const { view, record, strike } = strikeRecord(row);
          return view.getInt16(record + 6, true) / data.strikes[strike]!.planeUnitsPerEm;
        },
        (row) => {
          const { view, record, strike } = strikeRecord(row);
          return (
            (view.getInt16(record + 4, true) - view.getInt16(record, true)) / data.strikes[strike]!.planeUnitsPerEm
          );
        },
        (row) => {
          const { view, record, strike } = strikeRecord(row);
          return (
            (view.getInt16(record + 6, true) - view.getInt16(record + 2, true)) / data.strikes[strike]!.planeUnitsPerEm
          );
        },
        (row) => atlas(row, 8, 'width'),
        (row) => atlas(row, 10, 'height'),
        (row) => span(row, 8, 12, 'width'),
        (row) => span(row, 10, 14, 'height'),
      ],
    },
    strikeU32: emptyFontBindingTable(rows),
    resourceF32: emptyFontBindingTable(resources.length),
    resourceU32: emptyFontBindingTable(resources.length),
  });
}

function compileMsdf(
  glyphCount: number,
  data: MsdfData,
  techniqueId: number,
  identities: RenderWireIdentityRegistry,
): Uint8Array {
  const { resources, indexFor } = fontBindingResources([data.resource], identities);
  const view = recordView(data.records);
  const rowRecord = (row: number): number => row * 20;
  const pageAt = (row: number): number => view.getUint16(rowRecord(row) + 16, true);
  const atlas = (row: number, offset: number, dimension: 'width' | 'height'): number => {
    const page = pageAt(row);
    return page === ABSENT_PAGE ? 0 : view.getUint16(rowRecord(row) + offset, true) / data.pages[page]![dimension];
  };
  const span = (row: number, start: number, end: number, dimension: 'width' | 'height'): number => {
    const page = pageAt(row);
    const record = rowRecord(row);
    return page === ABSENT_PAGE
      ? 0
      : (view.getUint16(record + end, true) - view.getUint16(record + start, true)) / data.pages[page]![dimension];
  };
  return compileFontBinding({
    techniqueId,
    programVariant: 0,
    glyphCount,
    strikes: [0],
    resources,
    resourceIndex(row) {
      return pageAt(row) === ABSENT_PAGE ? MISSING_RESOURCE : indexFor(data.resource);
    },
    glyphF32: {
      rows: glyphCount,
      fields: [
        (row) => view.getInt16(rowRecord(row), true) / data.planeUnitsPerEm,
        (row) => view.getInt16(rowRecord(row) + 6, true) / data.planeUnitsPerEm,
        (row) => (view.getInt16(rowRecord(row) + 4, true) - view.getInt16(rowRecord(row), true)) / data.planeUnitsPerEm,
        (row) =>
          (view.getInt16(rowRecord(row) + 6, true) - view.getInt16(rowRecord(row) + 2, true)) / data.planeUnitsPerEm,
        (row) => atlas(row, 8, 'width'),
        (row) => atlas(row, 10, 'height'),
        (row) => span(row, 8, 12, 'width'),
        (row) => span(row, 10, 14, 'height'),
        (row) => atlas(row, 12, 'width'),
        (row) => atlas(row, 14, 'height'),
      ],
    },
    glyphU32: { rows: glyphCount, fields: [(row) => pageAt(row)] },
    strikeF32: emptyFontBindingTable(glyphCount),
    strikeU32: emptyFontBindingTable(glyphCount),
    resourceF32: emptyFontBindingTable(resources.length),
    resourceU32: emptyFontBindingTable(resources.length),
  });
}

function compileSlug(
  glyphCount: number,
  data: SlugData,
  techniqueId: number,
  identities: RenderWireIdentityRegistry,
): Uint8Array {
  const { resources, indexFor } = fontBindingResources(
    data.pages.map((page) => page.resource),
    identities,
  );
  const view = recordView(data.records);
  const record = (row: number): number => row * 40;
  const pageAt = (row: number): number => view.getUint16(record(row) + 8, true);
  const normalized = (row: number, offset: number): number =>
    view.getInt16(record(row) + offset, true) / data.planeUnitsPerEm;
  const width = (row: number): number => normalized(row, 4) - normalized(row, 0);
  const height = (row: number): number => normalized(row, 6) - normalized(row, 2);
  const horizontalBands = (row: number): number => view.getUint16(record(row) + 10, true);
  const verticalBands = (row: number): number => view.getUint16(record(row) + 12, true);
  const bandScaleX = (row: number): number => (width(row) === 0 ? 0 : verticalBands(row) / width(row));
  const bandScaleY = (row: number): number => (height(row) === 0 ? 0 : horizontalBands(row) / height(row));
  return compileFontBinding({
    techniqueId,
    programVariant: 0,
    glyphCount,
    strikes: [0],
    resources,
    resourceIndex(row) {
      const page = pageAt(row);
      return page === ABSENT_PAGE ? MISSING_RESOURCE : indexFor(data.pages[page]!.resource);
    },
    glyphF32: {
      rows: glyphCount,
      fields: [
        (row) => normalized(row, 0),
        (row) => normalized(row, 6),
        (row) => width(row),
        (row) => height(row),
        (row) => bandScaleX(row),
        (row) => bandScaleY(row),
        (row) => -normalized(row, 0) * bandScaleX(row),
        (row) => -normalized(row, 2) * bandScaleY(row),
      ],
    },
    glyphU32: {
      rows: glyphCount,
      fields: [
        (row) => view.getUint32(record(row) + 16, true),
        (row) => view.getUint32(record(row) + 24, true),
        (row) => view.getUint32(record(row) + 28, true),
        (row) => view.getUint32(record(row) + 32, true),
        (row) => horizontalBands(row),
        (row) => verticalBands(row),
      ],
    },
    strikeF32: emptyFontBindingTable(glyphCount),
    strikeU32: emptyFontBindingTable(glyphCount),
    resourceF32: emptyFontBindingTable(resources.length),
    resourceU32: emptyFontBindingTable(resources.length),
  });
}

export function fontBindingResources(
  keys: readonly RasterResourceId[],
  identities: RenderWireIdentityRegistry,
): {
  readonly resources: readonly BindingResource[];
  readonly indexFor: (key: RasterResourceId) => number;
} {
  const byKey = new Map<RasterResourceId, BindingResource>();
  const byId = new Map<number, RasterResourceId>();
  for (const key of keys) {
    if (byKey.has(key)) continue;
    const id = identities.resolve(key);
    const collision = byId.get(id);
    if (collision !== undefined && collision !== key) {
      throw new TypeError(`raster resource wire identity collision between "${collision}" and "${key}"`);
    }
    byId.set(id, key);
    byKey.set(key, { key, id, generation: 1, kind: 1, reference: id });
  }
  const resources = [...byKey.values()].sort((left, right) => left.id - right.id);
  const indexes = new Map(resources.map((resource, index) => [resource.key, index]));
  return {
    resources,
    indexFor(key) {
      const index = indexes.get(key);
      if (index === undefined) throw new TypeError(`font binding references unknown raster resource "${key}"`);
      return index;
    },
  };
}

export function compileFontBinding(descriptor: FontBindingDescriptor): Uint8Array {
  const request = textShaperAbi.layouts.fontBindingRequest;
  const strike = textShaperAbi.layouts.fontBindingStrike;
  const resource = textShaperAbi.layouts.fontBindingResource;
  const tables = [
    ['glyphF32', descriptor.glyphF32],
    ['glyphU32', descriptor.glyphU32],
    ['strikeF32', descriptor.strikeF32],
    ['strikeU32', descriptor.strikeU32],
    ['resourceF32', descriptor.resourceF32],
    ['resourceU32', descriptor.resourceU32],
  ] as const;
  let length: number = request.size;
  const allocate = (count: number, stride: number, alignment: number): number => {
    if (count === 0) return 0;
    const offset = align(length, alignment);
    length = checkedAdd(offset, checkedProduct(count, stride, 'font binding table'), 'font binding bytes');
    return offset;
  };
  const strikesOffset = allocate(descriptor.strikes.length, strike.size, strike.alignment);
  const resourcesOffset = allocate(descriptor.resources.length, resource.size, resource.alignment);
  const resourceIndicesOffset = allocate(
    checkedProduct(descriptor.glyphCount, descriptor.strikes.length, 'font resource rows'),
    4,
    4,
  );
  const tableOffsets = tables.map(([, table]) =>
    allocate(checkedProduct(table.rows, table.fields.length, 'font binding fields'), 4, 4),
  );
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  view.setUint32(request.abiVersion, textShaperAbi.version, true);
  view.setUint32(request.byteLength, bytes.byteLength, true);
  view.setUint32(request.techniqueId, descriptor.techniqueId, true);
  view.setUint16(request.programVariant, descriptor.programVariant, true);
  view.setUint32(request.glyphCount, descriptor.glyphCount, true);
  view.setUint32(request.strikeCount, descriptor.strikes.length, true);
  view.setUint32(request.resourceCount, descriptor.resources.length, true);
  view.setUint32(request.strikesOffset, strikesOffset, true);
  view.setUint32(request.resourcesOffset, resourcesOffset, true);
  view.setUint32(request.resourceIndicesOffset, resourceIndicesOffset, true);

  for (const [index, ppem] of descriptor.strikes.entries()) {
    view.setUint32(strikesOffset + index * strike.size + strike.ppem, ppem, true);
  }
  for (const [index, value] of descriptor.resources.entries()) {
    const offset = resourcesOffset + index * resource.size;
    view.setUint32(offset + resource.id, value.id, true);
    view.setUint32(offset + resource.generation, value.generation, true);
    view.setUint16(offset + resource.kind, value.kind, true);
    view.setUint32(offset + resource.reference, value.reference, true);
  }
  const resourceRows = descriptor.glyphCount * descriptor.strikes.length;
  for (let row = 0; row < resourceRows; row += 1) {
    view.setUint32(resourceIndicesOffset + row * 4, descriptor.resourceIndex(row), true);
  }
  for (const [tableIndex, [name, table]] of tables.entries()) {
    if (table.fields.length > 32) throw new RangeError(`${name} has more than 32 fields`);
    view.setUint8(request[`${name}FieldCount`], table.fields.length);
    view.setUint32(request[`${name}Offset`], tableOffsets[tableIndex]!, true);
    for (const [fieldIndex, read] of table.fields.entries()) {
      const fieldOffset = tableOffsets[tableIndex]! + fieldIndex * table.rows * 4;
      for (let row = 0; row < table.rows; row += 1) {
        const value = read(row);
        if (name.endsWith('F32')) {
          if (!Number.isFinite(value)) throw new TypeError(`${name} produced a nonfinite value`);
          view.setFloat32(fieldOffset + row * 4, value, true);
        } else {
          view.setUint32(fieldOffset + row * 4, uint32(value, `${name} value`), true);
        }
      }
    }
  }
  return bytes;
}

export function emptyFontBindingTable(rows: number): FontBindingFieldTable {
  return { rows, fields: [] };
}

function recordView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function checkedAdd(left: number, right: number, label: string): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value > MAX_U32) throw new RangeError(`${label} exceeds u32`);
  return value;
}

function checkedProduct(left: number, right: number, label: string): number {
  const value = left * right;
  if (!Number.isSafeInteger(value) || value > MAX_U32) throw new RangeError(`${label} exceeds u32`);
  return value;
}

function uint32(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_U32) throw new RangeError(`${label} must be a u32`);
  return value;
}
