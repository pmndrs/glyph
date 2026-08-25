import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type { LoadedFont } from '../loaded-font.js';
import { bitmap, bitmapSchema, type BitmapData } from '../raster/bitmap-technique.js';
import { msdf, msdfSchema, type MsdfData } from '../raster/msdf.js';
import { slug, slugSchema, type SlugData } from '../raster/slug-technique.js';
import type { AnyRasterTechnique, RasterResourceId } from '../raster-technique.js';
import { RenderWireIdentityRegistry } from './render-policy.js';
import { compileRasterFont } from './raster-plan-program.js';

const MAX_U32 = 0xffff_ffff;
const MAX_U16 = 0xffff;
const ABSENT_PAGE = 0xffff;
const MISSING_RESOURCE = 0xffff_ffff;
const MAX_BINDING_FIELDS = 32;

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
  /** Declared names retained for field-specific compiler diagnostics. */
  readonly names?: readonly string[];
}

/**
 * Order a binding table by the schema's declared field names. The same name
 * list drives the policy program's input table, so a missing, extra, or
 * misspelled reader is a compile error instead of a silently shifted column.
 */
export function schemaFieldTable<const Names extends readonly string[]>(
  names: Names,
  rows: number,
  readers: { readonly [Name in Names[number]]: (row: number) => number },
): FontBindingFieldTable {
  return { rows, fields: names.map((name: Names[number]) => readers[name]), names };
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

/** Compile one loaded font's binding bytes; registered portable resources are dropped from this byte-only projection. */
export function loadedFontBindingBytes(
  font: LoadedFont<AnyRasterTechnique>,
  identities: RenderWireIdentityRegistry = new RenderWireIdentityRegistry(),
): Uint8Array {
  const compiled = compileRasterFont(font, identities);
  if (compiled !== undefined) return compiled.binding;
  if (font.technique.id === bitmap.id && isBitmapData(font.data)) {
    return compileBitmap(font.font.glyphCount, font.data, identities.techniqueId(bitmap), identities);
  }
  if (font.technique.id === msdf.id && isMsdfData(font.data)) {
    return compileMsdf(font.font.glyphCount, font.data, identities.techniqueId(msdf), identities);
  }
  if (font.technique.id === slug.id && isSlugData(font.data)) {
    return compileSlug(font.font.glyphCount, font.data, identities.techniqueId(slug), identities);
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
  const entries = data.strikes.map((strike) => strike.pages[0]!.resource);
  const { resources, indexFor } = fontBindingResources(entries, identities);
  const views = data.strikes.map((strike) => recordView(strike.records));
  const bindings = data.strikes.map((strike) => ({
    width: Math.max(...strike.pages.map((page) => page.width)),
    height: Math.max(...strike.pages.map((page) => page.height)),
  }));
  const rows = checkedProduct(glyphCount, data.strikes.length, 'bitmap strike rows');
  const strikeRecord = (row: number): { readonly view: DataView; readonly record: number; readonly strike: number } => {
    const strike = Math.floor(row / glyphCount);
    return { view: views[strike]!, record: (row % glyphCount) * 20, strike };
  };
  const atlas = (row: number, offset: number, dimension: 'width' | 'height'): number => {
    const { view, record, strike } = strikeRecord(row);
    const page = view.getUint16(record + 16, true);
    return page === ABSENT_PAGE ? 0 : view.getUint16(record + offset, true) / bindings[strike]![dimension];
  };
  const span = (row: number, start: number, end: number, dimension: 'width' | 'height'): number => {
    const { view, record, strike } = strikeRecord(row);
    const page = view.getUint16(record + 16, true);
    return page === ABSENT_PAGE
      ? 0
      : (view.getUint16(record + end, true) - view.getUint16(record + start, true)) / bindings[strike]![dimension];
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
      return page === ABSENT_PAGE ? MISSING_RESOURCE : indexFor(data.strikes[strike]!.pages[0]!.resource);
    },
    glyphF32: emptyFontBindingTable(glyphCount),
    glyphU32: emptyFontBindingTable(glyphCount),
    strikeF32: schemaFieldTable(bitmapSchema.binding.f32, rows, {
      bearingX: (row) => {
        const { view, record, strike } = strikeRecord(row);
        return view.getInt16(record, true) / data.strikes[strike]!.planeUnitsPerEm;
      },
      bearingY: (row) => {
        const { view, record, strike } = strikeRecord(row);
        return view.getInt16(record + 6, true) / data.strikes[strike]!.planeUnitsPerEm;
      },
      width: (row) => {
        const { view, record, strike } = strikeRecord(row);
        return (view.getInt16(record + 4, true) - view.getInt16(record, true)) / data.strikes[strike]!.planeUnitsPerEm;
      },
      height: (row) => {
        const { view, record, strike } = strikeRecord(row);
        return (
          (view.getInt16(record + 6, true) - view.getInt16(record + 2, true)) / data.strikes[strike]!.planeUnitsPerEm
        );
      },
      uvOriginX: (row) => atlas(row, 8, 'width'),
      uvOriginY: (row) => atlas(row, 10, 'height'),
      uvSizeX: (row) => span(row, 8, 12, 'width'),
      uvSizeY: (row) => span(row, 10, 14, 'height'),
    }),
    strikeU32: schemaFieldTable(bitmapSchema.binding.u32, rows, {
      page: (row) => {
        const { view, record } = strikeRecord(row);
        return view.getUint16(record + 16, true);
      },
    }),
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
    return page === ABSENT_PAGE ? 0 : view.getUint16(rowRecord(row) + offset, true) / data.binding[dimension];
  };
  const span = (row: number, start: number, end: number, dimension: 'width' | 'height'): number => {
    const page = pageAt(row);
    const record = rowRecord(row);
    return page === ABSENT_PAGE
      ? 0
      : (view.getUint16(record + end, true) - view.getUint16(record + start, true)) / data.binding[dimension];
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
    glyphF32: schemaFieldTable(msdfSchema.binding.f32, glyphCount, {
      bearingX: (row) => view.getInt16(rowRecord(row), true) / data.planeUnitsPerEm,
      bearingY: (row) => view.getInt16(rowRecord(row) + 6, true) / data.planeUnitsPerEm,
      width: (row) =>
        (view.getInt16(rowRecord(row) + 4, true) - view.getInt16(rowRecord(row), true)) / data.planeUnitsPerEm,
      height: (row) =>
        (view.getInt16(rowRecord(row) + 6, true) - view.getInt16(rowRecord(row) + 2, true)) / data.planeUnitsPerEm,
      uvOriginX: (row) => atlas(row, 8, 'width'),
      uvOriginY: (row) => atlas(row, 10, 'height'),
      uvSizeX: (row) => span(row, 8, 12, 'width'),
      uvSizeY: (row) => span(row, 10, 14, 'height'),
      uvMaxX: (row) => atlas(row, 12, 'width'),
      uvMaxY: (row) => atlas(row, 14, 'height'),
    }),
    glyphU32: schemaFieldTable(msdfSchema.binding.u32, glyphCount, { page: (row) => pageAt(row) }),
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
    glyphF32: schemaFieldTable(slugSchema.binding.f32, glyphCount, {
      bearingX: (row) => normalized(row, 0),
      bearingY: (row) => normalized(row, 6),
      width: (row) => width(row),
      height: (row) => height(row),
      bandScaleX: (row) => bandScaleX(row),
      bandScaleY: (row) => bandScaleY(row),
      bandOffsetX: (row) => -normalized(row, 0) * bandScaleX(row),
      bandOffsetY: (row) => -normalized(row, 2) * bandScaleY(row),
    }),
    glyphU32: schemaFieldTable(slugSchema.binding.u32, glyphCount, {
      curveStart: (row) => view.getUint32(record(row) + 16, true),
      headerStart: (row) => view.getUint32(record(row) + 24, true),
      referenceStart: (row) => view.getUint32(record(row) + 28, true),
      bandStart: (row) => view.getUint32(record(row) + 32, true),
      horizontalBands: (row) => horizontalBands(row),
      verticalBands: (row) => verticalBands(row),
    }),
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
    const id = identities.resourceId(key);
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

interface BindingResourceSnapshot {
  readonly id: number;
  readonly generation: number;
  readonly kind: number;
  readonly reference: number;
}

interface BindingTablePlan {
  readonly rows: number;
  readonly fieldCount: number;
  readonly float: boolean;
  readonly readers: readonly ((row: number) => number)[];
  readonly names?: readonly string[];
}

interface BindingTableSnapshot extends Omit<BindingTablePlan, 'readers' | 'names'> {
  readonly values: Float32Array | Uint32Array;
}

/** Compile one font binding only after the complete candidate has validated. */
export function compileFontBinding(descriptor: FontBindingDescriptor): Uint8Array {
  if (!isRecord(descriptor)) throw new TypeError('font binding descriptor must be an object');
  const { techniqueId, programVariant, glyphCount, strikes, resources, resourceIndex } = descriptor;
  const { glyphF32, glyphU32, strikeF32, strikeU32, resourceF32, resourceU32 } = descriptor;

  const wireTechniqueId = uint32(techniqueId, 'font binding techniqueId');
  if (wireTechniqueId === 0) throw new RangeError('font binding techniqueId must not be the reserved zero technique');
  const wireProgramVariant = uint16(programVariant, 'font binding programVariant');
  const wireGlyphCount = uint32(glyphCount, 'font binding glyphCount');
  if (wireGlyphCount === 0) throw new RangeError('font binding glyphCount must be positive');
  if (wireGlyphCount > MAX_U16) {
    throw new RangeError(`font binding glyphCount ${wireGlyphCount} exceeds the u16 wire maximum`);
  }
  const strikePpems = validateStrikes(strikes);
  const resourceSnapshots = validateResources(resources);
  if (typeof resourceIndex !== 'function') throw new TypeError('font binding resourceIndex must be a function');

  const strikeRows = checkedProduct(wireGlyphCount, strikePpems.length, 'font resource rows');
  const tables = [
    ['glyphF32', glyphF32, wireGlyphCount],
    ['glyphU32', glyphU32, wireGlyphCount],
    ['strikeF32', strikeF32, strikeRows],
    ['strikeU32', strikeU32, strikeRows],
    ['resourceF32', resourceF32, resourceSnapshots.length],
    ['resourceU32', resourceU32, resourceSnapshots.length],
  ] as const;
  const plans = tables.map(([name, table, expectedRows]) => planTable(name, table, expectedRows));

  checkedProduct(strikeRows, 4, 'font resource index bytes');
  const selectedResources = new Uint32Array(strikeRows);
  for (let row = 0; row < strikeRows; row += 1) {
    const index = uint32(resourceIndex(row), `font binding resourceIndex(${row})`);
    if (index !== MISSING_RESOURCE && index >= resourceSnapshots.length) {
      throw new RangeError(
        `font binding resourceIndex(${row}) selected resource ${index} outside the ${resourceSnapshots.length} declared resources`,
      );
    }
    selectedResources[row] = index;
  }
  const snapshots = plans.map((plan, index) => snapshotTable(tables[index]![0], plan));

  const request = textShaperAbi.layouts.fontBindingRequest;
  const strike = textShaperAbi.layouts.fontBindingStrike;
  const resource = textShaperAbi.layouts.fontBindingResource;
  let length: number = request.size;
  const allocate = (count: number, stride: number, alignment: number): number => {
    if (count === 0) return 0;
    const offset = align(length, alignment);
    length = checkedAdd(offset, checkedProduct(count, stride, 'font binding table'), 'font binding bytes');
    return offset;
  };
  const strikesOffset = allocate(strikePpems.length, strike.size, strike.alignment);
  const resourcesOffset = allocate(resourceSnapshots.length, resource.size, resource.alignment);
  const resourceIndicesOffset = allocate(selectedResources.length, 4, 4);
  const tableOffsets = snapshots.map((snapshot) =>
    allocate(checkedProduct(snapshot.rows, snapshot.fieldCount, 'font binding fields'), 4, 4),
  );

  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  view.setUint32(request.abiVersion, textShaperAbi.version, true);
  view.setUint32(request.byteLength, bytes.byteLength, true);
  view.setUint32(request.techniqueId, wireTechniqueId, true);
  view.setUint16(request.programVariant, wireProgramVariant, true);
  view.setUint32(request.glyphCount, wireGlyphCount, true);
  view.setUint32(request.strikeCount, strikePpems.length, true);
  view.setUint32(request.resourceCount, resourceSnapshots.length, true);
  view.setUint32(request.strikesOffset, strikesOffset, true);
  view.setUint32(request.resourcesOffset, resourcesOffset, true);
  view.setUint32(request.resourceIndicesOffset, resourceIndicesOffset, true);

  for (const [index, ppem] of strikePpems.entries()) {
    view.setUint32(strikesOffset + index * strike.size + strike.ppem, ppem, true);
  }
  for (const [index, value] of resourceSnapshots.entries()) {
    const offset = resourcesOffset + index * resource.size;
    view.setUint32(offset + resource.id, value.id, true);
    view.setUint32(offset + resource.generation, value.generation, true);
    view.setUint16(offset + resource.kind, value.kind, true);
    view.setUint32(offset + resource.reference, value.reference, true);
  }
  for (let row = 0; row < selectedResources.length; row += 1) {
    view.setUint32(resourceIndicesOffset + row * 4, selectedResources[row]!, true);
  }
  for (const [tableIndex, snapshot] of snapshots.entries()) {
    const name = tables[tableIndex]![0];
    view.setUint8(request[`${name}FieldCount`], snapshot.fieldCount);
    view.setUint32(request[`${name}Offset`], tableOffsets[tableIndex]!, true);
    for (let fieldIndex = 0; fieldIndex < snapshot.fieldCount; fieldIndex += 1) {
      const fieldOffset = tableOffsets[tableIndex]! + fieldIndex * snapshot.rows * 4;
      for (let row = 0; row < snapshot.rows; row += 1) {
        const value = snapshot.values[fieldIndex * snapshot.rows + row]!;
        if (snapshot.float) view.setFloat32(fieldOffset + row * 4, value, true);
        else view.setUint32(fieldOffset + row * 4, value, true);
      }
    }
  }
  return bytes;
}

function validateStrikes(strikes: readonly number[]): readonly number[] {
  if (!Array.isArray(strikes)) throw new TypeError('font binding strikes must be an array');
  if (strikes.length === 0 || strikes.length > MAX_U16) {
    throw new RangeError(`font binding strikes must contain between 1 and ${MAX_U16} entries`);
  }
  const ppems = strikes.map((ppem, index) => uint32(ppem, `font binding strikes[${index}] ppem`));
  if (ppems[0] === 0 && ppems.length !== 1) {
    throw new RangeError('font binding strikes may only start at ppem 0 as the sole scalable strike');
  }
  for (let index = 1; index < ppems.length; index += 1) {
    if (ppems[index - 1]! >= ppems[index]!) {
      throw new RangeError(`font binding strikes[${index}] ppem ${ppems[index]} must strictly increase`);
    }
  }
  return ppems;
}

function validateResources(resources: readonly BindingResource[]): readonly BindingResourceSnapshot[] {
  if (!Array.isArray(resources)) throw new TypeError('font binding resources must be an array');
  if (resources.length === 0 || resources.length > MAX_U16) {
    throw new RangeError(`font binding resources must contain between 1 and ${MAX_U16} entries`);
  }
  const snapshots = resources.map((value, index): BindingResourceSnapshot => {
    if (!isRecord(value)) throw new TypeError(`font binding resources[${index}] must be an object`);
    const id = uint32(value.id, `font binding resources[${index}].id`);
    const generation = uint32(value.generation, `font binding resources[${index}].generation`);
    const kind = uint16(value.kind, `font binding resources[${index}].kind`);
    const reference = uint32(value.reference, `font binding resources[${index}].reference`);
    if (id === 0) throw new RangeError(`font binding resources[${index}].id must not be the reserved zero identity`);
    if (generation === 0) {
      throw new RangeError(`font binding resources[${index}].generation must not be the reserved zero generation`);
    }
    if (kind < 1 || kind > 32) {
      throw new RangeError(`font binding resources[${index}].kind ${kind} must be between 1 and 32`);
    }
    return { id, generation, kind, reference };
  });
  for (let index = 1; index < snapshots.length; index += 1) {
    if (snapshots[index - 1]!.id >= snapshots[index]!.id) {
      throw new RangeError(`font binding resources[${index}].id ${snapshots[index]!.id} must strictly increase`);
    }
  }
  return snapshots;
}

function planTable(name: string, table: FontBindingFieldTable, expectedRows: number): BindingTablePlan {
  if (!isRecord(table)) throw new TypeError(`font binding ${name} must be a field table`);
  const rows = table.rows;
  if (!Number.isSafeInteger(rows) || rows < 0) throw new RangeError(`font binding ${name} rows must be a u32`);
  if (rows !== expectedRows) {
    throw new RangeError(`font binding ${name} declares ${rows} rows but this binding needs ${expectedRows}`);
  }
  const fields = table.fields;
  if (!Array.isArray(fields)) throw new TypeError(`font binding ${name} fields must be an array`);
  if (fields.length > MAX_BINDING_FIELDS) {
    throw new RangeError(`${name} has more than ${MAX_BINDING_FIELDS} fields`);
  }
  const names = table.names;
  if (
    names !== undefined &&
    (!Array.isArray(names) || names.length !== fields.length || names.some((field) => typeof field !== 'string'))
  ) {
    throw new TypeError(`font binding ${name} names must match its fields`);
  }
  const readers = fields.map((read, fieldIndex) => {
    if (typeof read !== 'function') {
      throw new TypeError(`font binding ${fieldName(name, names, fieldIndex)} must be a function`);
    }
    return read;
  });
  const valueCount = checkedProduct(expectedRows, readers.length, `font binding ${name} values`);
  checkedProduct(valueCount, 4, `font binding ${name} bytes`);
  return {
    rows: expectedRows,
    fieldCount: readers.length,
    float: name.endsWith('F32'),
    readers,
    ...(names === undefined ? {} : { names }),
  };
}

function snapshotTable(name: string, plan: BindingTablePlan): BindingTableSnapshot {
  const values = plan.float
    ? new Float32Array(plan.rows * plan.fieldCount)
    : new Uint32Array(plan.rows * plan.fieldCount);
  for (let fieldIndex = 0; fieldIndex < plan.readers.length; fieldIndex += 1) {
    const read = plan.readers[fieldIndex]!;
    const base = fieldIndex * plan.rows;
    for (let row = 0; row < plan.rows; row += 1) {
      const value = read(row);
      const where = `${fieldName(name, plan.names, fieldIndex)} row ${row}`;
      if (plan.float) {
        if (!Number.isFinite(value)) throw new TypeError(`font binding ${where} produced a nonfinite value`);
        const narrowed = Math.fround(value);
        if (!Number.isFinite(narrowed)) {
          throw new TypeError(`font binding ${where} produced ${value}, which is not a finite f32`);
        }
        values[base + row] = narrowed;
      } else {
        values[base + row] = uint32(value, `font binding ${where}`);
      }
    }
  }
  return { rows: plan.rows, fieldCount: plan.fieldCount, float: plan.float, values };
}

function fieldName(name: string, names: readonly string[] | undefined, fieldIndex: number): string {
  const label = names?.[fieldIndex];
  return label === undefined ? `${name} field ${fieldIndex}` : `${name}.${label}`;
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

function uint32(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > MAX_U32) {
    throw new RangeError(`${label} must be a u32`);
  }
  return value;
}

function uint16(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > MAX_U16) {
    throw new RangeError(`${label} must be a u16`);
  }
  return value;
}
