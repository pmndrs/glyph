/**
 * The single authority for a raster technique's physical shape. A schema declares —
 * once, colocated with the technique — the buffer ids, scalar kinds, and lane
 * meanings that its policy programs produce and its shader realizations consume.
 * Policy stores, binding compilers, plan executors, and shader interfaces all
 * derive from the declaration; none of them restate it.
 */

import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type { PolicyBuffer } from './render-policy.js';

export type PolicyScalarKind = 'f32' | 'u32';

export interface PolicyBufferDeclaration {
  /** Wire buffer id — nonzero, unique within the owning program. */
  readonly id: number;
  readonly scalar: PolicyScalarKind;
  /** One name per lane; the lane count is the buffer's vector width. */
  readonly lanes: readonly string[];
}

export type PolicyBufferDeclarations = Readonly<Record<string, PolicyBufferDeclaration>>;

/**
 * Validate and freeze a named buffer set: nonzero unique ids, at least one lane
 * each. The result is an owned, deeply frozen copy — caller input is never
 * mutated (rejection leaves it untouched), and caller accessors are read once
 * here so they can never change a validated width afterwards.
 */
export function definePolicyBuffers<const Buffers extends PolicyBufferDeclarations>(buffers: Buffers): Buffers {
  const seen = new Set<number>();
  const owned: Record<string, PolicyBufferDeclaration> = {};
  for (const [name, buffer] of Object.entries(buffers)) {
    const id = buffer.id;
    const scalar = buffer.scalar;
    const lanes = [...buffer.lanes];
    if (!Number.isSafeInteger(id) || id <= 0 || id > 0xffff) {
      throw new RangeError(`policy buffer "${name}" needs a nonzero u16 id`);
    }
    if (seen.has(id)) throw new TypeError(`policy buffer "${name}" reuses id ${id}`);
    seen.add(id);
    if (scalar !== 'f32' && scalar !== 'u32') {
      throw new TypeError(`policy buffer "${name}" needs an f32 or u32 scalar kind`);
    }
    if (lanes.length === 0 || lanes.length > 4) {
      throw new RangeError(`policy buffer "${name}" needs one to four named lanes`);
    }
    owned[name] = Object.freeze({ id, scalar, lanes: Object.freeze(lanes) });
  }
  // The copy carries exactly the declared keys read above, so it satisfies Buffers.
  return Object.freeze(owned) as Buffers;
}

export interface TechniqueBindingDeclaration {
  readonly f32?: readonly string[];
  readonly u32?: readonly string[];
}

export interface TechniqueResourceDeclaration {
  readonly kind: string;
  readonly format?: string;
}

export interface TechniqueSchemaDeclaration<
  Buffers extends PolicyBufferDeclarations = PolicyBufferDeclarations,
  Binding extends TechniqueBindingDeclaration = TechniqueBindingDeclaration,
> {
  /** Wire identity string, e.g. `pmndrs.bitmap`. */
  readonly technique: string;
  /** Binding input scope the technique's per-glyph data arrives through. */
  readonly scope: 'glyph' | 'strike' | 'resource';
  readonly binding: Binding;
  readonly buffers: Buffers;
  readonly resources?: Readonly<Record<string, TechniqueResourceDeclaration>>;
  /**
   * Opt-in glyph-origin metadata: names the declared f32 buffer whose first two
   * lanes carry the glyph's inline/block origin. Renderers that augment glyph
   * origins (animation retargeting) consult this instead of assuming a layout;
   * techniques without it are never augmented.
   */
  readonly glyphOrigin?: { readonly buffer: string };
}

export interface TechniqueSchema<
  Buffers extends PolicyBufferDeclarations = PolicyBufferDeclarations,
  Binding extends TechniqueBindingDeclaration = TechniqueBindingDeclaration,
> extends TechniqueSchemaDeclaration<Buffers, Binding> {}

/** Validate and freeze one technique's authoritative schema. */
export function defineTechniqueSchema<
  const Buffers extends PolicyBufferDeclarations,
  const Binding extends TechniqueBindingDeclaration,
>(declaration: TechniqueSchemaDeclaration<Buffers, Binding>): TechniqueSchema<Buffers, Binding> {
  // Read every input property exactly once into owned structures, validate the
  // owned data, then freeze and return the copy. Caller input is never mutated
  // or frozen — a rejected declaration leaves it exactly as passed — and only
  // the declared fields are carried, so no foreign reachable state survives.
  const technique = declaration.technique;
  if (technique.length === 0) throw new TypeError('technique schemas need a wire identity');
  const scope = declaration.scope;
  if (scope !== 'glyph' && scope !== 'strike' && scope !== 'resource') {
    throw new TypeError(`technique "${technique}" needs a glyph, strike, or resource binding scope`);
  }
  const bindingF32 = declaration.binding.f32 === undefined ? undefined : Object.freeze([...declaration.binding.f32]);
  const bindingU32 = declaration.binding.u32 === undefined ? undefined : Object.freeze([...declaration.binding.u32]);
  const names = [...(bindingF32 ?? []), ...(bindingU32 ?? [])];
  if (new Set(names).size !== names.length) {
    throw new TypeError(`technique "${technique}" repeats a binding field name`);
  }
  const buffers = definePolicyBuffers(declaration.buffers);
  let resources: Readonly<Record<string, TechniqueResourceDeclaration>> | undefined;
  if (declaration.resources !== undefined) {
    const owned: Record<string, TechniqueResourceDeclaration> = {};
    for (const [name, resource] of Object.entries(declaration.resources)) {
      const format = resource.format;
      owned[name] = Object.freeze({ kind: resource.kind, ...(format === undefined ? {} : { format }) });
    }
    resources = Object.freeze(owned);
  }
  let glyphOrigin: { readonly buffer: string } | undefined;
  if (declaration.glyphOrigin !== undefined) {
    const origin: PolicyBufferDeclaration | undefined = buffers[declaration.glyphOrigin.buffer];
    if (origin === undefined) {
      throw new TypeError(`technique "${technique}" points glyphOrigin at an undeclared buffer`);
    }
    if (origin.scalar !== 'f32' || origin.lanes.length < 2) {
      throw new TypeError(`technique "${technique}" needs an f32 glyphOrigin buffer with two origin lanes`);
    }
    glyphOrigin = Object.freeze({ buffer: declaration.glyphOrigin.buffer });
  }
  const binding = Object.freeze({
    ...(bindingF32 === undefined ? {} : { f32: bindingF32 }),
    ...(bindingU32 === undefined ? {} : { u32: bindingU32 }),
    // The copies carry exactly the declared binding names read above.
  }) as Binding;
  return Object.freeze({
    technique,
    scope,
    binding,
    buffers,
    ...(resources === undefined ? {} : { resources }),
    ...(glyphOrigin === undefined ? {} : { glyphOrigin }),
  });
}

/**
 * Derive the wire buffer list a technique's programs publish, in declaration
 * order — the schema is the only witness to ids, scalar kinds, and widths.
 */
export function schemaPolicyBuffers(schema: TechniqueSchema): PolicyBuffer[] {
  const scalars = textShaperAbi.policy.scalarTypes;
  return Object.values(schema.buffers).map((buffer) => ({
    id: buffer.id,
    scalar: buffer.scalar === 'f32' ? scalars.f32 : scalars.u32,
    vectorWidth: buffer.lanes.length,
  }));
}
