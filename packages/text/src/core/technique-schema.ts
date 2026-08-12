/**
 * The single authority for a raster technique's physical shape. A schema declares —
 * once, colocated with the technique — the buffer ids, scalar kinds, and lane
 * meanings that its policy programs produce and its shader realizations consume.
 * Policy stores, binding compilers, plan executors, and shader interfaces all
 * derive from the declaration; none of them restate it.
 */

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
  }
  return buffers;
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
  return declaration;
}
