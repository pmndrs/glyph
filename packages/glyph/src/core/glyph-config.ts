import type { GlyphEngine } from '../glyph-engine.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import type { BackendMaterialBinding, BackendTransformBinding } from './backend.js';
import type { PolicyBuffer, PolicyDescriptor, PolicyProgram, RenderIdFactory } from './render-policy.js';
import type { PlanAcceptance, PlanCandidate } from './render-planner.js';

declare const typedCommandBufferBrand: unique symbol;
declare const typedCommandIdentityBrand: unique symbol;
const glyphConfigBrand: unique symbol = Symbol('pmndrs.glyph.config');

/** One lazily projected borrowed sequence. Values expire with their command buffer. */
export interface BorrowedCommandSequence<Value> extends Iterable<Value> {
  readonly length: number;
  at(index: number): Value | undefined;
}

/** Opaque retained identities. Numeric Rust IDs never cross the decoder boundary. */
export interface TypedResource {
  readonly [typedCommandIdentityBrand]: 'resource';
}
export interface TypedBuffer {
  readonly [typedCommandIdentityBrand]: 'buffer';
}
export interface TypedProgram {
  readonly [typedCommandIdentityBrand]: 'program';
}
export interface TypedMaterial {
  readonly [typedCommandIdentityBrand]: 'material';
}
export interface TransformIdentity {
  readonly [typedCommandIdentityBrand]: 'transform';
}
export interface BatchIdentity {
  readonly [typedCommandIdentityBrand]: 'batch';
}
export interface InstanceIdentity {
  readonly [typedCommandIdentityBrand]: 'instance';
}
export interface InstanceSpanIdentity {
  readonly [typedCommandIdentityBrand]: 'instance-span';
}
export interface ClipIdentity {
  readonly [typedCommandIdentityBrand]: 'clip';
}
export interface SemanticIdentity {
  readonly [typedCommandIdentityBrand]: 'semantic';
}

export type TypedResourceCommand = Readonly<{
  kind: 'acquire' | 'update' | 'retain';
  resource: TypedResource;
}>;

export type TypedBufferCommand = Readonly<{
  kind: 'ensure';
  buffer: TypedBuffer;
  program: TypedProgram;
  scalarType: 'f32' | 'u32' | 'u16';
  vectorWidth: number;
  capacityRecords: number;
  byteLength: number;
}>;

export type TypedPatchCommand =
  | Readonly<{
      kind: 'allocate-or-resize';
      buffer: TypedBuffer;
      destinationOffset: number;
      byteLength: number;
    }>
  | Readonly<{ kind: 'write'; buffer: TypedBuffer; destinationOffset: number; payload: Uint8Array }>
  | Readonly<{
      kind: 'fill';
      buffer: TypedBuffer;
      destinationOffset: number;
      byteLength: number;
      value: number;
    }>
  | Readonly<{
      kind: 'copy';
      source: TypedBuffer;
      sourceOffset: number;
      destination: TypedBuffer;
      destinationOffset: number;
      byteLength: number;
    }>
  | Readonly<{
      kind: 'retire';
      buffer: TypedBuffer;
      destinationOffset: number;
      byteLength: number;
    }>;

export interface TypedInstanceSpan {
  readonly identity: InstanceSpanIdentity;
  readonly kind: 'glyph' | 'decoration' | 'inline-object' | 'clip' | 'codec';
  readonly recordIndex: number;
  readonly recordCount: number;
  readonly logicalOrder: number;
}

export interface TypedBatch {
  readonly kind: 'batch';
  readonly identity: BatchIdentity;
  readonly instances: BorrowedCommandSequence<TypedInstanceSpan>;
}

export interface TypedRootInstance {
  readonly kind: 'instance';
  readonly identity: InstanceIdentity;
  readonly transform: TransformIdentity | undefined;
}

export type TypedGroupChild = TypedBatch | TypedRootInstance;

export interface TypedGroup {
  /** Rust draw order is authoritative; batches and root instances remain interleaved. */
  readonly children: BorrowedCommandSequence<TypedGroupChild>;
}

export type TypedGroupPhase = Readonly<{ kind: 'unchanged' }> | Readonly<{ kind: 'replace'; value: TypedGroup }>;

export type TypedRetirementCommand =
  | Readonly<{ kind: 'resource'; resource: TypedResource }>
  | Readonly<{ kind: 'buffer'; buffer: TypedBuffer }>
  | Readonly<{ kind: 'slot-range'; byteOffset: number; byteLength: number }>
  | Readonly<{ kind: 'output-bytes'; byteOffset: number; byteLength: number }>;

export interface TypedUpdatePhases {
  readonly resources: BorrowedCommandSequence<TypedResourceCommand>;
  readonly buffers: BorrowedCommandSequence<TypedBufferCommand>;
  readonly patches: BorrowedCommandSequence<TypedPatchCommand>;
  readonly retirements: BorrowedCommandSequence<TypedRetirementCommand>;
}

/**
 * Engine-owned zero-copy view offered to exactly one synchronous decoder call.
 * Scalar fields remain in the trusted Rust publication; only opaque identities are interned.
 */
export interface BorrowedTypedCommandBuffer {
  readonly delivery: 'borrowed';
  readonly engineRevision: number;
  readonly planRevision: number;
  readonly publicationGeneration: number;
  readonly checkpoint: boolean;
  readonly updates: TypedUpdatePhases;
  readonly group: TypedGroupPhase;
  readonly [typedCommandBufferBrand]: true;
}

/** Renderer binding vocabulary selected by one GlyphConfig. */
export interface GlyphBindings<
  Resource extends object,
  Buffer extends object,
  Program extends object,
  Material extends object,
  Transform extends object,
  Batch extends object,
  Instance extends object,
  InstanceSpan extends object,
  DrawRoot extends object | undefined = Transform,
> {
  readonly resource: Resource;
  readonly buffer: Buffer;
  readonly program: Program;
  readonly material: Material;
  readonly transform: Transform;
  readonly batch: Batch;
  readonly instance: Instance;
  readonly instanceSpan: InstanceSpan;
  /** Per-boundary renderer root; integrations without scene hierarchy use `undefined`. */
  readonly drawRoot: DrawRoot;
}

export type AnyGlyphBindings = GlyphBindings<
  object,
  object,
  object,
  object,
  object,
  object,
  object,
  object,
  object | undefined
>;

export type GlyphBufferDeclaration = Readonly<{ kind: 'codec'; value: PolicyBuffer }> | Readonly<{ kind: 'order' }>;

export interface GlyphBufferBindingInput<Bindings extends AnyGlyphBindings> {
  readonly program: Bindings['program'];
  readonly declaration: GlyphBufferDeclaration;
}

export interface GlyphInstanceSpanBindingInput<Bindings extends AnyGlyphBindings> {
  readonly identity: InstanceSpanIdentity;
  readonly kind: TypedInstanceSpan['kind'];
  readonly program: Bindings['program'];
  readonly programVariant: number;
  readonly resource: Bindings['resource'] | undefined;
  readonly buffer: Bindings['buffer'] | undefined;
  readonly recordIndex: number;
  readonly recordCount: number;
  readonly logicalOrder: number;
  readonly clip: ClipIdentity | undefined;
  readonly semantic: SemanticIdentity | undefined;
  readonly inlineStart: number;
  readonly blockStart: number;
  readonly inlineExtent: number;
  readonly blockExtent: number;
}

export interface GlyphDrawBindingInput<Bindings extends AnyGlyphBindings> {
  readonly program: Bindings['program'];
  readonly programVariant: number;
  readonly material: Bindings['material'] | undefined;
  readonly buffers: BorrowedCommandSequence<Bindings['buffer']>;
  readonly resources: BorrowedCommandSequence<Bindings['resource']>;
  readonly flags: number;
  readonly clip: ClipIdentity | undefined;
  readonly depthKey: number;
  readonly order: number;
  readonly indirect: Readonly<{ buffer: Bindings['buffer']; byteOffset: number }> | undefined;
}

export interface GlyphBatchBindingInput<Bindings extends AnyGlyphBindings> extends GlyphDrawBindingInput<Bindings> {
  readonly identity: BatchIdentity;
  readonly instances: BorrowedCommandSequence<BoundInstanceSpan<Bindings['instanceSpan']>>;
}

export interface GlyphRootInstanceBindingInput<
  Bindings extends AnyGlyphBindings,
> extends GlyphDrawBindingInput<Bindings> {
  readonly identity: InstanceIdentity;
  readonly transform: Bindings['transform'] | undefined;
  readonly instance: BoundInstanceSpan<Bindings['instanceSpan']>;
}

/** Config-owned schema that binds trusted engine meanings to renderer payloads. */
export interface GlyphSchema<Bindings extends AnyGlyphBindings, Boundary> {
  drawRoot(boundary: Boundary): Bindings['drawRoot'];
  program(boundary: Boundary, program: PolicyProgram): Bindings['program'];
  buffer(boundary: Boundary, input: GlyphBufferBindingInput<Bindings>): Bindings['buffer'];
  material(boundary: Boundary, material: BackendMaterialBinding): Bindings['material'];
  transform(boundary: Boundary, transform: BackendTransformBinding, recordIndex: number): Bindings['transform'];
  batch(boundary: Boundary, input: GlyphBatchBindingInput<Bindings>): Bindings['batch'];
  instance(boundary: Boundary, input: GlyphRootInstanceBindingInput<Bindings>): Bindings['instance'];
  instanceSpan(boundary: Boundary, input: GlyphInstanceSpanBindingInput<Bindings>): Bindings['instanceSpan'];
}

/** Define one boundary schema while preserving the inferred boundary and draw-root types. */
export function defineGlyphSchema<Bindings extends AnyGlyphBindings>() {
  return function defineBoundarySchema<Boundary>(
    schema: GlyphSchema<Bindings, Boundary>,
  ): Readonly<GlyphSchema<Bindings, Boundary>> {
    if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
      throw new TypeError('Glyph schema must be an object');
    }
    for (const key of [
      'drawRoot',
      'program',
      'buffer',
      'material',
      'transform',
      'batch',
      'instance',
      'instanceSpan',
    ] as const) {
      if (typeof schema[key] !== 'function') throw new TypeError(`Glyph schema ${key} must be a function`);
    }
    return Object.freeze({ ...schema });
  };
}

/** Codec selected by `GlyphConfig.encode`; policy-named values remain an internal ABI detail. */
export interface Codec {
  readonly descriptor: PolicyDescriptor;
}

export interface EncodeContext {
  /** Renderer integration identity used only for diagnostics. */
  readonly integration: string;
  /** Collision-checked identities supplied by the handle's engine backend. */
  readonly ids: RenderIdFactory;
}

export interface ResourceLease<Value extends object> {
  readonly value: Value;
  readonly disposed: boolean;
  dispose(): void;
}

export interface ResolveContext<PortableResource = unknown, Previous extends object = object> {
  readonly technique: string;
  readonly resourceKind: string;
  readonly resourceName: string;
  readonly payload: PortableResource;
  /** All singleton companions selected from the same compiled font, keyed by schema name. */
  readonly resources: ReadonlyMap<string, unknown>;
  readonly previous: Previous | undefined;
  readonly signal: AbortSignal;
}

export type BoundResourceCommand<Resource extends object> =
  | Readonly<{ kind: 'acquire'; resource: Resource }>
  | Readonly<{ kind: 'update'; resource: Resource }>
  | Readonly<{ kind: 'retain'; resource: Resource }>;

export type BoundBufferCommand<Buffer extends object, Program extends object> = Readonly<{
  kind: 'ensure';
  buffer: Buffer;
  program: Program;
  scalarType: 'f32' | 'u32' | 'u16';
  vectorWidth: number;
  capacityRecords: number;
  byteLength: number;
}>;

export type BoundPatchCommand<Buffer extends object> =
  | Readonly<{
      kind: 'allocate-or-resize';
      buffer: Buffer;
      destinationOffset: number;
      byteLength: number;
    }>
  | Readonly<{ kind: 'write'; buffer: Buffer; destinationOffset: number; payload: Uint8Array }>
  | Readonly<{
      kind: 'fill';
      buffer: Buffer;
      destinationOffset: number;
      byteLength: number;
      value: number;
    }>
  | Readonly<{
      kind: 'copy';
      source: Buffer;
      sourceOffset: number;
      destination: Buffer;
      destinationOffset: number;
      byteLength: number;
    }>
  | Readonly<{
      kind: 'retire';
      buffer: Buffer;
      destinationOffset: number;
      byteLength: number;
    }>;

export interface BoundInstanceSpan<InstanceSpan extends object> {
  readonly value: InstanceSpan;
  readonly kind: 'glyph' | 'decoration' | 'inline-object' | 'clip' | 'codec';
  readonly recordIndex: number;
  readonly recordCount: number;
  readonly logicalOrder: number;
}

export interface BoundBatch<Batch extends object, InstanceSpan extends object> {
  readonly kind: 'batch';
  readonly value: Batch;
  readonly instances: BorrowedCommandSequence<BoundInstanceSpan<InstanceSpan>>;
}

export interface BoundRootInstance<Instance extends object, Transform extends object> {
  readonly kind: 'instance';
  readonly value: Instance;
  readonly transform: Transform | undefined;
}

export type BoundGroupChild<Bindings extends AnyGlyphBindings> =
  | BoundBatch<Bindings['batch'], Bindings['instanceSpan']>
  | BoundRootInstance<Bindings['instance'], Bindings['transform']>;

export interface BoundGroup<Bindings extends AnyGlyphBindings> {
  readonly drawRoot: Bindings['drawRoot'];
  readonly transforms: BorrowedCommandSequence<BoundTransformRecord<Bindings['transform']>>;
  readonly children: BorrowedCommandSequence<BoundGroupChild<Bindings>>;
}

export interface BoundTransformRecord<Transform extends object> {
  readonly value: Transform;
  /** Physical transform-table record selected by the Codec. */
  readonly recordIndex: number;
}

export type BoundGroupPhase<Bindings extends AnyGlyphBindings> =
  | Readonly<{ kind: 'unchanged' }>
  | Readonly<{ kind: 'replace'; value: BoundGroup<Bindings> }>;

export type BoundRetirementCommand<Resource extends object, Buffer extends object> =
  | Readonly<{ kind: 'resource'; resource: Resource }>
  | Readonly<{ kind: 'buffer'; buffer: Buffer }>
  | Readonly<{ kind: 'slot-range'; byteOffset: number; byteLength: number }>
  | Readonly<{ kind: 'output-bytes'; byteOffset: number; byteLength: number }>;

export interface BoundUpdatePhases<Bindings extends AnyGlyphBindings> {
  readonly resources: BorrowedCommandSequence<BoundResourceCommand<Bindings['resource']>>;
  readonly buffers: BorrowedCommandSequence<BoundBufferCommand<Bindings['buffer'], Bindings['program']>>;
  readonly patches: BorrowedCommandSequence<BoundPatchCommand<Bindings['buffer']>>;
  readonly retirements: BorrowedCommandSequence<BoundRetirementCommand<Bindings['resource'], Bindings['buffer']>>;
}

/**
 * One phase-structured renderer input. Every binding is an object identity; numeric
 * engine IDs remain private to the decoder/binder that produced this borrowed value.
 */
export interface BorrowedBoundCommandBuffer<Bindings extends AnyGlyphBindings> {
  readonly delivery: 'borrowed-bound';
  readonly engineRevision: number;
  readonly planRevision: number;
  readonly publicationGeneration: number;
  readonly checkpoint: boolean;
  readonly updates: BoundUpdatePhases<Bindings>;
  readonly group: BoundGroupPhase<Bindings>;
}

/** Engine-owned binding service passed to exactly one synchronous decoder call. */
export interface DecodeContext<Bindings extends AnyGlyphBindings> {
  decodeDefault(source: BorrowedTypedCommandBuffer): BorrowedBoundCommandBuffer<Bindings>;
}

/** Retained handle/boundary binder used by the renderer-neutral publication transaction. */
export interface GlyphCommandBufferBinder<Bindings extends AnyGlyphBindings> extends DecodeContext<Bindings> {
  source(candidate: PlanCandidate, signal: AbortSignal): BorrowedTypedCommandBuffer;
  settle(
    source: BorrowedTypedCommandBuffer,
    frame: BorrowedBoundCommandBuffer<Bindings> | undefined,
    accepted: boolean,
  ): void;
  dispose(): void;
}

export type Decoder<Bindings extends AnyGlyphBindings> = (
  source: BorrowedTypedCommandBuffer,
  context: DecodeContext<Bindings>,
) => BorrowedBoundCommandBuffer<Bindings>;

/** The canonical decoder remains explicit in every config and may be wrapped type-safely. */
export function defaultDecoder<Bindings extends AnyGlyphBindings>(
  source: BorrowedTypedCommandBuffer,
  context: DecodeContext<Bindings>,
): BorrowedBoundCommandBuffer<Bindings> {
  return context.decodeDefault(source);
}

export function defineDecoder<Bindings extends AnyGlyphBindings>(decoder: Decoder<Bindings>): Decoder<Bindings> {
  if (typeof decoder !== 'function') throw new TypeError('Glyph decoder must be a function');
  return decoder;
}

export interface PreparedRendererCommit<Result> {
  readonly result: Result;
  commit(): void;
  discard(): void;
}

export interface BoundTransformUpdate<Transform extends object> {
  readonly transform: Transform;
}

/** Adapter-side renderer: prepares retained host objects; it does not submit a host render pass. */
export interface GlyphRenderer<Bindings extends AnyGlyphBindings, Result> {
  prepare(frame: BorrowedBoundCommandBuffer<Bindings>): PreparedRendererCommit<Result>;
  syncTransforms(updates: readonly BoundTransformUpdate<Bindings['transform']>[]): void;
  dispose(): void;
}

export interface RendererContext<Bindings extends AnyGlyphBindings, Result = unknown> {
  readonly drawRoot: Bindings['drawRoot'];
  readonly signal: AbortSignal;
  /** Built-in renderer selected by an adapter before a config wrapper is applied. */
  readonly defaultRenderer?: GlyphRenderer<Bindings, Result>;
}

/**
 * Runs one borrowed publication transaction. Decode/prepare failures discard candidate
 * state; once commit begins, binder state follows the committed host branch even if cleanup throws.
 */
export function applyGlyphPublication<Bindings extends AnyGlyphBindings, Result>(
  candidate: PlanCandidate,
  signal: AbortSignal,
  decode: Decoder<Bindings>,
  binder: GlyphCommandBufferBinder<Bindings>,
  renderer: GlyphRenderer<Bindings, Result>,
): PlanAcceptance {
  if (signal.aborted) return { accepted: false, error: signal.reason };
  let source: BorrowedTypedCommandBuffer | undefined;
  let frame: BorrowedBoundCommandBuffer<Bindings> | undefined;
  let prepared: PreparedRendererCommit<Result> | undefined;
  let commitStarted = false;
  try {
    source = binder.source(candidate, signal);
    frame = decode(source, binder);
    prepared = renderer.prepare(frame);
    commitStarted = true;
    prepared.commit();
    binder.settle(source, frame, true);
    return { accepted: true };
  } catch (error) {
    try {
      prepared?.discard();
    } catch {
      // Preserve the decode, preparation, or commit failure as the target rejection.
    }
    if (source !== undefined) {
      try {
        binder.settle(source, frame, commitStarted);
      } catch {
        // A foreign custom-decoder frame is already rejected by the renderer/binder boundary.
      }
    }
    return { accepted: false, error };
  }
}

/** Renderer-defined publication root selected through one configured handle. */
export interface GlyphRoot {
  /** Stable customization label. `undefined` denotes the handle's anonymous root. */
  readonly name: string | undefined;
  readonly disposed: boolean;
  dispose(): void;
}

/** Root-owned lifecycle of one named adapter handle and its idempotent publication roots. */
export interface GlyphHandle<Root extends GlyphRoot = GlyphRoot> {
  /** Returns the idempotent named root. The handle itself fronts its anonymous default root. */
  (name: string): Root;
  readonly name: string;
  readonly disposed: boolean;
  dispose(): void;
}

export interface GlyphHandleFactoryContext {
  readonly name: string;
  readonly engine: GlyphEngine;
  readonly config: AnyGlyphConfig;
  /** Stamps handle lifecycle onto the adapter's callable root selector. */
  create<Root extends GlyphRoot, Extension extends (name: string) => Root>(
    extension: Extension,
    dispose: () => void,
  ): GlyphHandle<Root> & Extension;
}

/** Handle-relative technique keys used to resolve FontFace format declarations. */
export interface GlyphFontConfig<Techniques extends { readonly [Key in keyof Techniques]: AnyRasterTechnique }> {
  readonly default: Extract<keyof Techniques, string>;
  readonly techniques: Techniques;
  /** Finish adapter-specific technique activation before a FontFace load becomes observable. */
  loadTechnique?(technique: Techniques[keyof Techniques]): Promise<void>;
}

export interface GlyphConfig<
  Handle extends GlyphHandle,
  Bindings extends AnyGlyphBindings,
  RendererResult,
  PortableResource = unknown,
  FontTechniques extends { readonly [Key in keyof FontTechniques]: AnyRasterTechnique } = Readonly<
    Record<string, AnyRasterTechnique>
  >,
  Boundary = unknown,
> {
  readonly [glyphConfigBrand]: true;
  readonly schema: GlyphSchema<Bindings, Boundary>;
  readonly fonts?: GlyphFontConfig<FontTechniques>;
  encode(context: EncodeContext): Codec;
  readonly decode: Decoder<Bindings>;
  resolve(context: ResolveContext<PortableResource, Bindings['resource']>): ResourceLease<Bindings['resource']>;
  renderer(context: RendererContext<Bindings, RendererResult>): GlyphRenderer<Bindings, RendererResult>;
  createHandle(context: GlyphHandleFactoryContext): Handle;
}

/** Minimal covariant surface the root runtime needs to construct an inferred handle. */
export interface AnyGlyphConfig {
  readonly [glyphConfigBrand]: true;
  createHandle(context: GlyphHandleFactoryContext): GlyphHandle;
}

export type GlyphConfigHandle<Config> = Config extends {
  createHandle(context: GlyphHandleFactoryContext): infer Handle extends GlyphHandle;
}
  ? Handle
  : never;

export function defineGlyphConfig<
  Handle extends GlyphHandle,
  Bindings extends AnyGlyphBindings,
  RendererResult,
  PortableResource = unknown,
  FontTechniques extends { readonly [Key in keyof FontTechniques]: AnyRasterTechnique } = Readonly<
    Record<string, AnyRasterTechnique>
  >,
  Boundary = unknown,
>(
  config: Omit<
    GlyphConfig<Handle, Bindings, RendererResult, PortableResource, FontTechniques, Boundary>,
    typeof glyphConfigBrand
  >,
): GlyphConfig<Handle, Bindings, RendererResult, PortableResource, FontTechniques, Boundary> {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new TypeError('GlyphConfig must be an object');
  }
  for (const key of ['encode', 'decode', 'resolve', 'renderer', 'createHandle'] as const) {
    if (typeof config[key] !== 'function') throw new TypeError(`GlyphConfig.${key} must be a function`);
  }
  if (typeof config.schema !== 'object' || config.schema === null) {
    throw new TypeError('GlyphConfig.schema must be an object');
  }
  for (const key of [
    'drawRoot',
    'program',
    'buffer',
    'material',
    'transform',
    'batch',
    'instance',
    'instanceSpan',
  ] as const) {
    if (typeof config.schema[key] !== 'function') throw new TypeError(`GlyphConfig.schema must define ${key}`);
  }
  if (config.fonts !== undefined) {
    if (typeof config.fonts !== 'object' || config.fonts === null || Array.isArray(config.fonts)) {
      throw new TypeError('GlyphConfig.fonts must be an object');
    }
    if (
      typeof config.fonts.default !== 'string' ||
      typeof config.fonts.techniques !== 'object' ||
      config.fonts.techniques === null ||
      Array.isArray(config.fonts.techniques)
    ) {
      throw new TypeError('GlyphConfig.fonts needs a default key and technique map');
    }
  }
  return Object.freeze({ ...config, [glyphConfigBrand]: true as const });
}

/** Creates an idempotent, exactly-once resource lease. */
export function resourceLease<Value extends object>(value: Value, release: () => void): ResourceLease<Value> {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw new TypeError('Glyph resource lease value must be an object');
  }
  if (typeof release !== 'function') throw new TypeError('Glyph resource lease release must be a function');
  let disposed = false;
  return Object.freeze({
    value,
    get disposed(): boolean {
      return disposed;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      release();
    },
  });
}
