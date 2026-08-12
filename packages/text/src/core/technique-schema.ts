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

/** Validate and freeze a named buffer set: nonzero unique ids, at least one lane each. */
export function definePolicyBuffers<const Buffers extends PolicyBufferDeclarations>(buffers: Buffers): Buffers {
  const seen = new Set<number>();
  for (const [name, buffer] of Object.entries(buffers)) {
    if (!Number.isSafeInteger(buffer.id) || buffer.id <= 0 || buffer.id > 0xffff) {
      throw new RangeError(`policy buffer "${name}" needs a nonzero u16 id`);
    }
    if (seen.has(buffer.id)) throw new TypeError(`policy buffer "${name}" reuses id ${buffer.id}`);
    seen.add(buffer.id);
    if (buffer.lanes.length === 0 || buffer.lanes.length > 4) {
      throw new RangeError(`policy buffer "${name}" needs one to four named lanes`);
    }
    Object.freeze(buffer.lanes);
    Object.freeze(buffer);
  }
  return Object.freeze(buffers);
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
  if (declaration.technique.length === 0) throw new TypeError('technique schemas need a wire identity');
  definePolicyBuffers(declaration.buffers);
  const names = [...(declaration.binding.f32 ?? []), ...(declaration.binding.u32 ?? [])];
  if (new Set(names).size !== names.length) {
    throw new TypeError(`technique "${declaration.technique}" repeats a binding field name`);
  }
  if (declaration.glyphOrigin !== undefined) {
    const origin: PolicyBufferDeclaration | undefined = declaration.buffers[declaration.glyphOrigin.buffer];
    if (origin === undefined) {
      throw new TypeError(`technique "${declaration.technique}" points glyphOrigin at an undeclared buffer`);
    }
    if (origin.scalar !== 'f32' || origin.lanes.length < 2) {
      throw new TypeError(`technique "${declaration.technique}" needs an f32 glyphOrigin buffer with two origin lanes`);
    }
    Object.freeze(declaration.glyphOrigin);
  }
  Object.freeze(declaration.binding.f32);
  Object.freeze(declaration.binding.u32);
  Object.freeze(declaration.binding);
  if (declaration.resources !== undefined) {
    for (const resource of Object.values(declaration.resources)) Object.freeze(resource);
    Object.freeze(declaration.resources);
  }
  return Object.freeze(declaration);
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
