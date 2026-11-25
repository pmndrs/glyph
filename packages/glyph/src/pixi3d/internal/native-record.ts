import { Box, Geometry3D, Mesh3D, type BaseMaterial3D, type ShaderBit } from '@pixi/3d';
import { Buffer, BufferUsage } from 'pixi.js';
import { Pixi3DMeshPool } from './mesh-pool.js';
import { detachPixi3DTextMaterial } from '../material.js';

/** One Codec record is one native instance: its lanes live in Pixi's indexed material store. */
export interface NativeGlyphField {
  readonly name: string;
  readonly type: 'float32x2' | 'float32x4' | 'uint32x2' | 'uint32x4';
  readonly value: readonly number[];
}

const canonicalQuad = {};
const lowered = new WeakMap<ShaderBit, ShaderBit>();
const glyphAttributes = {
  aGlyphOrigin: 'float32x2',
  aGlyphSize: 'float32x2',
  aGlyphUvOrigin: 'float32x2',
  aGlyphUvSize: 'float32x2',
  aGlyphColor: 'float32x4',
  aGlyphRect: 'float32x4',
  aGlyphUvRect: 'float32x4',
  aGlyphUvBounds: 'float32x4',
  aGlyphEffectColor: 'uint32x2',
  aGlyphPage: 'float32x4',
  aGlyphPlaneRect: 'float32x4',
  aGlyphBandTransform: 'float32x4',
  aGlyphTableStarts: 'uint32x4',
  aGlyphBandCounts: 'uint32x4',
  aGlyphEffect: 'float32x2',
  aGlyphFacts: 'float32x4',
} as const;
const integer = (type: string): boolean => type.startsWith('uint');
const width = (type: string): number => Number(type.at(-1));
const fieldName = (name: string): string => `glyphRecord${name.slice(6)}`;

/** The same deterministic effect seed for attribute-backed and native-record glyphs. */
export function glyphSeed(ordinal: number): number {
  const value = Math.imul(ordinal + 1, 0x9e_37_79_b1);
  return ((value ^ (value >>> 16)) >>> 0) / 4_294_967_296;
}

/** Whether a caller recipe can use the canonical quad's inputs without losing host-owned attributes. */
export function nativeGlyphBitsSupported(bits: readonly ShaderBit[]): boolean {
  for (const bit of bits) {
    if (Object.keys(bit.bindings?.material ?? {}).some((name) => name.startsWith('glyphRecord'))) return false;
    for (const [name, type] of Object.entries(bit.attributes ?? {})) {
      const expected = Object.entries(glyphAttributes).find(([attribute]) => attribute === name)?.[1];
      if (name !== 'aPosition' && name !== 'aUV' && (expected === undefined || expected !== type)) return false;
    }
    // Header snippets can define functions with their own parameter names. They are not vertex slots.
    if (/\b(?:input\.)?aGlyph\w+\b/u.test(`${bit.gpu?.header ?? ''}${bit.gl?.header ?? ''}`)) return false;
  }
  return true;
}

/** Lower only Glyph's fixed per-record attributes; caller bits keep every other input unchanged. */
export function nativeGlyphBit(bit: ShaderBit): ShaderBit {
  const cached = lowered.get(bit);
  if (cached !== undefined) return cached;
  const attributes = { ...bit.attributes };
  const material = { ...bit.bindings?.material };
  const replacements = new Map<string, { gpu: string; gl: string }>();
  for (const [name, type] of Object.entries(glyphAttributes)) {
    const declared = attributes[name] !== undefined;
    delete attributes[name];
    const count = width(type);
    if (name === 'aGlyphEffect') {
      // A one-record span has ordinal zero, including detached glyph copies.
      const seed = glyphSeed(0);
      replacements.set(name, { gpu: `vec2<f32>(0.0, ${seed})`, gl: `vec2(0.0, ${seed})` });
    } else if (integer(type)) {
      const lanes = Array.from({ length: count }, (_, lane) => {
        const field = `${fieldName(name)}${lane}`;
        if (declared) material[field] = 'u32';
        return `material.${field}`;
      });
      replacements.set(name, { gpu: `vec${count}<u32>(${lanes.join(', ')})`, gl: `uvec${count}(${lanes.join(', ')})` });
    } else {
      const field = fieldName(name);
      if (declared) material[field] = count === 2 ? 'vec2<f32>' : 'vec4<f32>';
      replacements.set(name, { gpu: `material.${field}`, gl: `material.${field}` });
    }
  }
  const replace = (source: string, backend: 'gpu' | 'gl'): string => {
    for (const [name, expression] of replacements)
      source = source.replaceAll(
        new RegExp(`\\b${backend === 'gpu' ? 'input\\.' : ''}${name}\\b`, 'gu'),
        `(${expression[backend]})`,
      );
    return source;
  };
  const stages = (source: ShaderBit['gpu'], backend: 'gpu' | 'gl'): ShaderBit['gpu'] => {
    if (source === undefined) return undefined;
    return {
      ...source,
      ...(source.vertex === undefined
        ? {}
        : {
            vertex: Object.fromEntries(
              Object.entries(source.vertex).map(([key, value]) => [
                key,
                value === undefined ? undefined : replace(value, backend),
              ]),
            ),
          }),
    };
  };
  const result: ShaderBit = {
    ...bit,
    name: `${bit.name}:nativeRecord`,
    attributes,
    bindings: { ...bit.bindings, material },
    ...(bit.gpu === undefined ? {} : { gpu: stages(bit.gpu, 'gpu')! }),
    ...(bit.gl === undefined ? {} : { gl: stages(bit.gl, 'gl')! }),
  };
  delete result._identityChecked;
  delete result._contentSnapshot;
  lowered.set(bit, result);
  return result;
}

export function createNativeGlyphMesh(
  fields: readonly NativeGlyphField[],
  bounds: Box,
  create: () => BaseMaterial3D,
  pool: Pixi3DMeshPool,
): Mesh3D {
  // PixiJS 3D 0.1.0 sizes the material row to its fields, so a record always fits beside a recipe's own fields.
  const material = pool.uniqueMaterial(() => {
    const candidate = create();
    try {
      for (const { name, type, value } of fields) {
        if (integer(type)) {
          for (let lane = 0; lane < value.length; lane++) candidate.data[`${fieldName(name)}${lane}`] = value[lane]!;
        } else candidate.data[fieldName(name)] = Float32Array.from(value);
      }
      return candidate;
    } catch (error) {
      detachPixi3DTextMaterial(candidate);
      candidate.destroy();
      throw error;
    }
  });
  const geometry = pool.canonicalGeometry(
    canonicalQuad,
    () =>
      new Geometry3D({
        // Shader-owned positions vary per material. An empty sphere conservatively disables GPU culling;
        // boundsVolume and hitVolume below retain each instance's precise native bounds and picking.
        bounds3D: new Box(),
        attributes: {
          aPosition: {
            buffer: new Buffer({
              data: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
              usage: BufferUsage.VERTEX,
            }),
            format: 'float32x3',
            // Pixi's atlas counts vertices from stride; declaring the format alone yields NaN.
            stride: 12,
            offset: 0,
          },
          aUV: {
            buffer: new Buffer({ data: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), usage: BufferUsage.VERTEX }),
            format: 'float32x2',
            stride: 8,
            offset: 0,
          },
        },
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      }),
  );
  const mesh = new Mesh3D({ geometry, material, castShadow: false, receiveShadow: false });
  mesh.boundsVolume = bounds;
  mesh.hitVolume = bounds;
  pool.own(mesh);
  return mesh;
}
