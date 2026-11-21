import { BaseMaterial3D, Material3D, type ShaderBit } from '@pixi/3d';
import type { Texture } from 'pixi.js';

export type Pixi3DTextMaterialValue = number | readonly number[];
export type Pixi3DTextMaterialData = Readonly<Record<string, Pixi3DTextMaterialValue>>;

export type Pixi3DTextMaterialFormat = 'pmndrs.bitmap' | 'pmndrs.msdf' | 'pmndrs.slug';

/** Renderer-owned inputs required by a PixiJS 3D text material factory. */
export interface Pixi3DTextMaterialContext {
  readonly format: Pixi3DTextMaterialFormat;
  /** Ordered Glyph raster bits followed by the material's extension bits. */
  readonly bits: readonly ShaderBit[];
  /** Glyph atlas textures that the returned material must declare through `bits`. */
  readonly textures: Readonly<Record<string, Texture>>;
  /** Creates the standard lit PBR material with every required bit and texture binding. */
  createDefaultMaterial(): Material3D;
}

export type Pixi3DTextMaterialFactory = (context: Pixi3DTextMaterialContext) => BaseMaterial3D;

export interface Pixi3DTextMaterialOptions<Data extends Pixi3DTextMaterialData = Pixi3DTextMaterialData> {
  /** Pixi3D shader bits appended after Glyph's raster-format bit, in order. */
  readonly extraBits?: readonly ShaderBit[];
  /** Initial values for material-group fields declared by `extraBits`. */
  readonly data?: Data;
  /** Reuse compatible native materials for this recipe; custom factories opt in explicitly. */
  readonly shared?: boolean;
  /** Allows native one-record batching; defaults to true for the standard factory and false for custom `create`.
   * Custom factories opting in must compose the supplied bits and declare all Glyph-reading bits in `extraBits`.
   */
  readonly nativeRecords?: boolean;
  /** Creates a fresh material for each compatible realization (or each mesh without shared). */
  readonly create?: Pixi3DTextMaterialFactory;
}

interface MaterialState {
  readonly values: Map<string, number | Float32Array>;
  readonly materials: Set<BaseMaterial3D>;
}

const states = new WeakMap<Pixi3DTextMaterial, MaterialState>();
const attachments = new WeakMap<BaseMaterial3D, Pixi3DTextMaterial>();
const ownedMaterials = new WeakSet<BaseMaterial3D>();

/**
 * A stable Pixi3D material extension shared by one or more text objects.
 *
 * Shader bits are fixed at construction, matching Pixi3D materials. `update()` changes only their
 * material-group data and never reshapes text or rebuilds geometry.
 */
export class Pixi3DTextMaterial<Data extends Pixi3DTextMaterialData = Pixi3DTextMaterialData> {
  readonly extraBits: readonly ShaderBit[];
  readonly shared: boolean;
  /** Whether this recipe permits renderer-owned record fields and lowered Glyph vertex inputs. */
  readonly nativeRecords: boolean;
  readonly create: Pixi3DTextMaterialFactory | undefined;

  constructor(options: Pixi3DTextMaterialOptions<Data>) {
    assertOptions(options);
    this.extraBits = Object.freeze([...(options.extraBits ?? [])]);
    this.create = options.create;
    this.shared = options.shared ?? false;
    this.nativeRecords = options.nativeRecords ?? this.create === undefined;
    const values = new Map<string, number | Float32Array>();
    for (const [name, value] of Object.entries(options.data ?? {})) {
      values.set(name, normalizeValue(this.extraBits, name, value));
    }
    states.set(this, { values, materials: new Set() });
  }

  update(update: Partial<Data>): void {
    if (!isNonArrayObject(update)) throw new TypeError('Pixi3D text material update must be an object');
    const state = stateOf(this);
    for (const [name, value] of Object.entries(update)) {
      if (value === undefined) continue;
      const normalized = normalizeValue(this.extraBits, name, value);
      state.values.set(name, normalized);
      for (const material of state.materials) writeMaterialValue(material, name, normalized);
    }
  }
}

export function createPixi3DTextMaterial(
  extension: Pixi3DTextMaterial | undefined,
  format: Pixi3DTextMaterialFormat,
  bits: readonly ShaderBit[],
  textures: Readonly<Record<string, Texture>>,
): BaseMaterial3D {
  const orderedBits = Object.freeze([...bits]);
  const requiredTextures = Object.freeze({ ...textures });
  const createDefaultMaterial = (): Material3D =>
    new Material3D({ alphaMode: 'blend', doubleSided: true, fog: false, extraBits: orderedBits });
  const context = Object.freeze({ format, bits: orderedBits, textures: requiredTextures, createDefaultMaterial });
  const material = extension?.create?.(context) ?? createDefaultMaterial();
  if (!(material instanceof BaseMaterial3D)) {
    throw new TypeError('Pixi3D text material factory must return a BaseMaterial3D');
  }
  if (ownedMaterials.has(material)) {
    throw new TypeError('Pixi3D text material factory must return a fresh unowned material');
  }
  ownedMaterials.add(material);
  try {
    for (const [name, texture] of Object.entries(requiredTextures)) material.textures[name] = texture;
    if (extension !== undefined) attachPixi3DTextMaterial(extension, material);
    return material;
  } catch (error) {
    material.destroy();
    throw error;
  }
}

export function attachPixi3DTextMaterial(extension: Pixi3DTextMaterial, material: BaseMaterial3D): void {
  const state = stateOf(extension);
  for (const [name, value] of state.values) writeMaterialValue(material, name, value);
  state.materials.add(material);
  attachments.set(material, extension);
}

export function detachPixi3DTextMaterial(material: BaseMaterial3D): void {
  const extension = attachments.get(material);
  if (extension === undefined) return;
  stateOf(extension).materials.delete(material);
  attachments.delete(material);
}

export function isPixi3DTextMaterial(value: unknown): value is Pixi3DTextMaterial {
  return typeof value === 'object' && value !== null && states.has(value as Pixi3DTextMaterial);
}

function assertOptions(options: Pixi3DTextMaterialOptions): void {
  if (!isNonArrayObject(options)) throw new TypeError('Pixi3D text material options must be an object');
  if (options.extraBits !== undefined && !Array.isArray(options.extraBits)) {
    throw new TypeError('Pixi3D text material extraBits must be an array');
  }
  if (options.data !== undefined && !isNonArrayObject(options.data)) {
    throw new TypeError('Pixi3D text material data must be an object');
  }
  if (options.shared !== undefined && typeof options.shared !== 'boolean')
    throw new TypeError('Pixi3D shared material option must be a boolean');
  if (options.nativeRecords !== undefined && typeof options.nativeRecords !== 'boolean') {
    throw new TypeError('Pixi3D nativeRecords material option must be a boolean');
  }
  if (options.create !== undefined && typeof options.create !== 'function') {
    throw new TypeError('Pixi3D text material create must be a function');
  }
}

function normalizeValue(
  bits: readonly ShaderBit[],
  name: string,
  value: Pixi3DTextMaterialValue,
): number | Float32Array {
  const type = materialFieldType(bits, name);
  const components = componentCount(type);
  if (components === 1) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`Pixi3D text material field ${name} must be a finite number`);
    }
    return value;
  }
  if (!Array.isArray(value) || value.length !== components || value.some((component) => !Number.isFinite(component))) {
    throw new TypeError(`Pixi3D text material field ${name} must contain ${String(components)} finite numbers`);
  }
  return Float32Array.from(value);
}

function materialFieldType(bits: readonly ShaderBit[], name: string): string {
  for (const bit of bits) {
    const field = bit.bindings?.material?.[name];
    if (field === undefined) continue;
    // A field is a bare WGSL type or `{ type, visibility }`; any other object is a nested uniform group.
    const type = typeof field === 'string' ? field : typeof field.type === 'string' ? field.type : undefined;
    if (
      type === undefined ||
      type.startsWith('texture_') ||
      type.startsWith('sampler') ||
      type.startsWith('storage<')
    ) {
      throw new TypeError(`Pixi3D text material field ${name} is not uniform data`);
    }
    return type;
  }
  throw new TypeError(`Pixi3D text material data has no declared field named ${name}`);
}

function componentCount(type: string): number {
  if (type === 'f32' || type === 'i32' || type === 'u32') return 1;
  const vector = /^vec([234])<[^>]+>$/.exec(type);
  if (vector !== null) return Number(vector[1]);
  const matrix = /^mat([234])x([234])<f32>$/.exec(type);
  if (matrix !== null) return Number(matrix[1]) * Number(matrix[2]);
  throw new TypeError(`Pixi3D text material field type ${type} is unsupported`);
}

function writeMaterialValue(material: BaseMaterial3D, name: string, value: number | Float32Array): void {
  material.data[name] = value;
}

function stateOf(extension: Pixi3DTextMaterial): MaterialState {
  const state = states.get(extension);
  if (state === undefined) throw new TypeError('Unknown Pixi3D text material extension');
  return state;
}

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
