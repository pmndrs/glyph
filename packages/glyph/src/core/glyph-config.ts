import type { GlyphEngine } from '../glyph-engine.js';
import type { PolicyDescriptor, RenderIdFactory } from './render-policy.js';
import type { PlanAcceptance, PlanCandidate } from './render-planner.js';

declare const typedCommandBufferBrand: unique symbol;
const glyphConfigBrand: unique symbol = Symbol('pmndrs.glyph.config');

/** The engine-owned, borrowed command buffer offered to one decoder call. */
export interface BorrowedTypedCommandBuffer {
  readonly delivery: 'borrowed';
  readonly checkpoint: boolean;
  readonly [typedCommandBufferBrand]: true;
}

/** Renderer binding vocabulary selected by one GlyphConfig. */
export interface GlyphBindings<
  Resource extends object,
  Buffer extends object,
  Program extends object,
  Material extends object,
  Transform extends object,
  Primitive extends object,
  Draw extends object,
> {
  readonly resource: Resource;
  readonly buffer: Buffer;
  readonly program: Program;
  readonly material: Material;
  readonly transform: Transform;
  readonly primitive: Primitive;
  readonly draw: Draw;
}

export type AnyGlyphBindings = GlyphBindings<object, object, object, object, object, object, object>;

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
    }>;

export interface BoundPrimitiveCommand<
  Resource extends object,
  Buffer extends object,
  Program extends object,
  Primitive extends object,
> {
  readonly primitive: Primitive;
  readonly kind: 'glyph' | 'decoration' | 'inline-object' | 'clip' | 'codec';
  readonly program: Program;
  readonly resource: Resource | undefined;
  readonly buffers: readonly Buffer[];
  readonly recordIndex: number;
  readonly recordCount: number;
  readonly logicalOrder: number;
}

export interface BoundDrawCommand<
  Buffer extends object,
  Program extends object,
  Material extends object,
  Transform extends object,
  Primitive extends object,
  Draw extends object,
> {
  readonly draw: Draw;
  readonly program: Program;
  readonly material: Material | undefined;
  readonly transform: Transform;
  readonly buffers: readonly Buffer[];
  readonly primitives: readonly Primitive[];
  readonly depthKey: number;
}

export type BoundDrawPhase<DrawCommand> =
  | Readonly<{ kind: 'unchanged' }>
  | Readonly<{ kind: 'replace'; values: readonly DrawCommand[] }>;

export type BoundRetirementCommand<Resource extends object, Buffer extends object> =
  | Readonly<{ kind: 'resource'; resource: Resource }>
  | Readonly<{ kind: 'buffer'; buffer: Buffer }>;

/**
 * One phase-structured renderer input. Every binding is an object identity; numeric
 * engine IDs remain private to the decoder/binder that produced this borrowed value.
 */
export interface BorrowedBoundCommandBuffer<Bindings extends AnyGlyphBindings> {
  readonly delivery: 'borrowed-bound';
  readonly checkpoint: boolean;
  readonly resources: readonly BoundResourceCommand<Bindings['resource']>[];
  readonly buffers: readonly BoundBufferCommand<Bindings['buffer'], Bindings['program']>[];
  readonly patches: readonly BoundPatchCommand<Bindings['buffer']>[];
  readonly primitives: readonly BoundPrimitiveCommand<
    Bindings['resource'],
    Bindings['buffer'],
    Bindings['program'],
    Bindings['primitive']
  >[];
  readonly draws: BoundDrawPhase<
    BoundDrawCommand<
      Bindings['buffer'],
      Bindings['program'],
      Bindings['material'],
      Bindings['transform'],
      Bindings['primitive'],
      Bindings['draw']
    >
  >;
  readonly retirements: readonly BoundRetirementCommand<Bindings['resource'], Bindings['buffer']>[];
}

/** Engine-owned binding service passed to exactly one synchronous decoder call. */
export interface DecodeContext<Bindings extends AnyGlyphBindings> {
  decodeDefault(source: BorrowedTypedCommandBuffer): BorrowedBoundCommandBuffer<Bindings>;
}

/** Retained handle/boundary binder used by the renderer-neutral publication transaction. */
export interface GlyphCommandBufferBinder<Bindings extends AnyGlyphBindings> extends DecodeContext<Bindings> {
  source(candidate: PlanCandidate, signal: AbortSignal): BorrowedTypedCommandBuffer;
  settle(frame: BorrowedBoundCommandBuffer<Bindings>, accepted: boolean): void;
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

export interface RendererContext<Bindings extends AnyGlyphBindings> {
  readonly drawRoot: Bindings['transform'];
  readonly signal: AbortSignal;
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
  let frame: BorrowedBoundCommandBuffer<Bindings> | undefined;
  let prepared: PreparedRendererCommit<Result> | undefined;
  let commitStarted = false;
  try {
    frame = decode(binder.source(candidate, signal), binder);
    prepared = renderer.prepare(frame);
    commitStarted = true;
    prepared.commit();
    binder.settle(frame, true);
    return { accepted: true };
  } catch (error) {
    try {
      prepared?.discard();
    } catch {
      // Preserve the decode, preparation, or commit failure as the target rejection.
    }
    if (frame !== undefined) {
      try {
        binder.settle(frame, commitStarted);
      } catch {
        // A foreign custom-decoder frame is already rejected by the renderer/binder boundary.
      }
    }
    return { accepted: false, error };
  }
}

/** Root-owned lifecycle of one named adapter handle. */
export interface GlyphHandle {
  readonly name: string;
  readonly disposed: boolean;
  dispose(): void;
}

export interface GlyphHandleFactoryContext {
  readonly name: string;
  readonly engine: GlyphEngine;
  readonly config: AnyGlyphConfig;
  create<Extension extends object>(extension: Extension, dispose: () => void): GlyphHandle & Extension;
}

export interface GlyphConfig<
  Handle extends GlyphHandle,
  Bindings extends AnyGlyphBindings,
  RendererResult,
  PortableResource = unknown,
  Capabilities = unknown,
> {
  readonly [glyphConfigBrand]: true;
  readonly capabilities: Capabilities;
  encode(context: EncodeContext): Codec;
  readonly decode: Decoder<Bindings>;
  resolve(context: ResolveContext<PortableResource, Bindings['resource']>): ResourceLease<Bindings['resource']>;
  renderer(context: RendererContext<Bindings>): GlyphRenderer<Bindings, RendererResult>;
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
  Capabilities = unknown,
>(
  config: Omit<GlyphConfig<Handle, Bindings, RendererResult, PortableResource, Capabilities>, typeof glyphConfigBrand>,
): GlyphConfig<Handle, Bindings, RendererResult, PortableResource, Capabilities> {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new TypeError('GlyphConfig must be an object');
  }
  for (const key of ['encode', 'decode', 'resolve', 'renderer', 'createHandle'] as const) {
    if (typeof config[key] !== 'function') throw new TypeError(`GlyphConfig.${key} must be a function`);
  }
  return Object.freeze({ ...config, [glyphConfigBrand]: true });
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
