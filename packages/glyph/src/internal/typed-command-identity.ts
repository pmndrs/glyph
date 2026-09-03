declare const typedCommandIdentityBrand: unique symbol;

type TypedCommandIdentityKind =
  | 'resource'
  | 'buffer'
  | 'program'
  | 'material'
  | 'transform'
  | 'batch'
  | 'instance'
  | 'instance-span'
  | 'clip'
  | 'semantic';

interface TypedCommandIdentity<Kind extends TypedCommandIdentityKind> {
  readonly [typedCommandIdentityBrand]: Kind;
}

export type TypedResource = TypedCommandIdentity<'resource'>;
export type TypedBuffer = TypedCommandIdentity<'buffer'>;
export type TypedProgram = TypedCommandIdentity<'program'>;
export type TypedMaterial = TypedCommandIdentity<'material'>;
export type TransformIdentity = TypedCommandIdentity<'transform'>;
export type BatchIdentity = TypedCommandIdentity<'batch'>;
export type InstanceIdentity = TypedCommandIdentity<'instance'>;
export type InstanceSpanIdentity = TypedCommandIdentity<'instance-span'>;
export type ClipIdentity = TypedCommandIdentity<'clip'>;
export type SemanticIdentity = TypedCommandIdentity<'semantic'>;

class TypedCommandIdentityImpl<Kind extends TypedCommandIdentityKind> implements TypedCommandIdentity<Kind> {
  declare readonly [typedCommandIdentityBrand]: Kind;
}

/** @internal Create one package-owned opaque identity without exposing its numeric Rust key. */
export function createTypedCommandIdentity<Kind extends TypedCommandIdentityKind>(
  _kind: Kind,
): TypedCommandIdentity<Kind> {
  return Object.freeze(new TypedCommandIdentityImpl<Kind>());
}
