import type { Font } from '../font.js';
import type { GlyphEngine } from '../glyph-engine.js';
import type { AnyFontFaceSelection } from '../font-face.js';
import type { GlyphLayoutInspection, ParagraphLayoutSummary } from '../layout.js';
import type { FontSelection } from '../loaded-font.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import type { Constraints, ParagraphLayout, TextStyle } from '../text-properties.js';
import { createConfiguredGlyphHandle } from '../internal/configured-handle.js';
import type {
  PolicyBuffer as CodecBuffer,
  PolicyDescriptor as CodecDescriptor,
  PolicyProgram as CodecProgram,
  RenderIdFactory as CodecIdFactory,
} from './render-policy.js';
import type {
  PlanAcceptance,
  PlanCandidate,
  RenderPlannerLimits,
  RenderPlannerPublishOptions,
} from './render-planner.js';

declare const typedCommandBufferBrand: unique symbol;
declare const typedCommandIdentityBrand: unique symbol;
const glyphConfigBrand: unique symbol = Symbol('pmndrs.glyph.config');
const glyphConfigHandleFactory: unique symbol = Symbol('pmndrs.glyph.config.handle-factory');
declare const glyphConfigRootType: unique symbol;

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
  MaterialInput = Material,
  TransformInput = Transform,
  InlineResourceInput = Resource,
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
  /** Adapter-authored material value accepted by root Text state. */
  readonly materialInput: MaterialInput;
  /** Adapter-authored transform value accepted by root Text state. */
  readonly transformInput: TransformInput;
  /** Adapter-authored inline resource accepted by root Text state. */
  readonly inlineResourceInput: InlineResourceInput;
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
  object | undefined,
  unknown,
  unknown,
  unknown
>;

export type GlyphBufferDeclaration = Readonly<{ kind: 'codec'; value: CodecBuffer }> | Readonly<{ kind: 'order' }>;

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
  readonly instances: BorrowedCommandSequence<DisplayListInstanceSpan<Bindings['instanceSpan']>>;
}

export interface GlyphRootInstanceBindingInput<
  Bindings extends AnyGlyphBindings,
> extends GlyphDrawBindingInput<Bindings> {
  readonly identity: InstanceIdentity;
  readonly transform: Bindings['transform'] | undefined;
  readonly instance: DisplayListInstanceSpan<Bindings['instanceSpan']>;
}

/** Config-owned schema that binds trusted engine meanings to renderer payloads. */
export interface GlyphSchema<Bindings extends AnyGlyphBindings, Boundary> {
  drawRoot(boundary: Boundary): Bindings['drawRoot'];
  program(boundary: Boundary, program: CodecProgram): Bindings['program'];
  buffer(boundary: Boundary, input: GlyphBufferBindingInput<Bindings>): Bindings['buffer'];
  material(boundary: Boundary, material: Bindings['materialInput']): Bindings['material'];
  transform(boundary: Boundary, transform: Bindings['transformInput'], recordIndex: number): Bindings['transform'];
  batch(boundary: Boundary, input: GlyphBatchBindingInput<Bindings>): Bindings['batch'];
  instance(boundary: Boundary, input: GlyphRootInstanceBindingInput<Bindings>): Bindings['instance'];
  instanceSpan(boundary: Boundary, input: GlyphInstanceSpanBindingInput<Bindings>): Bindings['instanceSpan'];
}

type DefinedGlyphBindings<
  Resource extends object,
  Buffer extends object,
  Program extends object,
  Material extends object,
  Transform extends object,
  Batch extends object,
  Instance extends object,
  InstanceSpan extends object,
  DrawRoot extends object | undefined,
  MaterialInput,
  TransformInput,
  InlineResourceInput,
> = GlyphBindings<
  Resource,
  Buffer,
  Program,
  Material,
  Transform,
  Batch,
  Instance,
  InstanceSpan,
  DrawRoot,
  MaterialInput,
  TransformInput,
  InlineResourceInput
>;

/** Define one boundary schema while inferring its complete binding vocabulary from the callbacks. */
export function defineGlyphSchema<
  Resource extends object,
  Buffer extends object,
  Program extends object,
  Material extends object,
  Transform extends object,
  Batch extends object,
  Instance extends object,
  InstanceSpan extends object,
  DrawRoot extends object | undefined,
  MaterialInput = Material,
  TransformInput = Transform,
  InlineResourceInput = Resource,
  Boundary = unknown,
>(
  schema: GlyphSchema<
    DefinedGlyphBindings<
      Resource,
      Buffer,
      Program,
      Material,
      Transform,
      Batch,
      Instance,
      InstanceSpan,
      DrawRoot,
      MaterialInput,
      TransformInput,
      InlineResourceInput
    >,
    Boundary
  >,
): Readonly<typeof schema> {
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
}

/** Codec selected by `GlyphConfig.encode`; policy-named values remain an internal ABI detail. */
export interface Codec {
  readonly descriptor: CodecDescriptor;
  /** Selects one descriptor capability set; omission selects the descriptor's first set. */
  readonly capabilitySet?: number;
  /** Releases encode-owned registrations after every root and font lease has stopped. */
  dispose?(): void;
}

export interface EncodeContext {
  /** Renderer integration identity used only for diagnostics. */
  readonly integration: string;
  /** Collision-checked identities supplied by the handle's engine state. */
  readonly ids: CodecIdFactory;
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
  readonly resources: ReadonlyMap<string, PortableResource>;
  readonly previous: Previous | undefined;
  readonly signal: AbortSignal;
}

export type ResourceUpdate<Resource extends object> =
  | Readonly<{ kind: 'acquire'; resource: Resource }>
  | Readonly<{ kind: 'update'; resource: Resource }>
  | Readonly<{ kind: 'retain'; resource: Resource }>;

export type BufferUpdate<Buffer extends object, Program extends object> = Readonly<{
  kind: 'ensure';
  buffer: Buffer;
  program: Program;
  scalarType: 'f32' | 'u32' | 'u16';
  vectorWidth: number;
  capacityRecords: number;
  byteLength: number;
}>;

export type BufferPatch<Buffer extends object> =
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

export interface DisplayListInstanceSpan<InstanceSpan extends object> {
  readonly value: InstanceSpan;
  readonly kind: 'glyph' | 'decoration' | 'inline-object' | 'clip' | 'codec';
  readonly recordIndex: number;
  readonly recordCount: number;
  readonly logicalOrder: number;
}

export interface DisplayListBatch<Batch extends object, InstanceSpan extends object> {
  readonly kind: 'batch';
  readonly value: Batch;
  readonly instances: BorrowedCommandSequence<DisplayListInstanceSpan<InstanceSpan>>;
}

export interface DisplayListRootInstance<Instance extends object, Transform extends object> {
  readonly kind: 'instance';
  readonly value: Instance;
  readonly transform: Transform | undefined;
}

export type DisplayListChild<Bindings extends AnyGlyphBindings> =
  | DisplayListBatch<Bindings['batch'], Bindings['instanceSpan']>
  | DisplayListRootInstance<Bindings['instance'], Bindings['transform']>;

export interface DisplayList<Bindings extends AnyGlyphBindings> {
  readonly drawRoot: Bindings['drawRoot'];
  readonly transforms: BorrowedCommandSequence<DisplayListTransform<Bindings['transform']>>;
  readonly children: BorrowedCommandSequence<DisplayListChild<Bindings>>;
}

export interface DisplayListTransform<Transform extends object> {
  readonly value: Transform;
  /** Physical transform-table record selected by the Codec. */
  readonly recordIndex: number;
}

export type DisplayListPhase<Bindings extends AnyGlyphBindings> =
  | Readonly<{ kind: 'unchanged' }>
  | Readonly<{ kind: 'replace'; value: DisplayList<Bindings> }>;

export type Retirement<Resource extends object, Buffer extends object> =
  | Readonly<{ kind: 'resource'; resource: Resource }>
  | Readonly<{ kind: 'buffer'; buffer: Buffer }>
  | Readonly<{ kind: 'slot-range'; byteOffset: number; byteLength: number }>
  | Readonly<{ kind: 'output-bytes'; byteOffset: number; byteLength: number }>;

export interface DisplayListChanges<Bindings extends AnyGlyphBindings> {
  readonly resources: BorrowedCommandSequence<ResourceUpdate<Bindings['resource']>>;
  readonly buffers: BorrowedCommandSequence<BufferUpdate<Bindings['buffer'], Bindings['program']>>;
  readonly patches: BorrowedCommandSequence<BufferPatch<Bindings['buffer']>>;
  readonly retirements: BorrowedCommandSequence<Retirement<Bindings['resource'], Bindings['buffer']>>;
}

/**
 * One phase-structured retained display-list update. Every reference is already a typed
 * binding; numeric engine IDs and the trusted wire representation remain private.
 */
export interface CommandBufferView<Bindings extends AnyGlyphBindings> {
  readonly delivery: 'borrowed-command-buffer';
  readonly engineRevision: number;
  readonly planRevision: number;
  readonly publicationGeneration: number;
  readonly checkpoint: boolean;
  readonly updates: DisplayListChanges<Bindings>;
  readonly displayList: DisplayListPhase<Bindings>;
}

/** Internal retained projector used by one root's renderer publication transaction. */
export interface GlyphDisplayListProjector<Bindings extends AnyGlyphBindings> {
  source(candidate: PlanCandidate, signal: AbortSignal): BorrowedTypedCommandBuffer;
  project(source: BorrowedTypedCommandBuffer): CommandBufferView<Bindings>;
  settle(source: BorrowedTypedCommandBuffer, update: CommandBufferView<Bindings> | undefined, accepted: boolean): void;
  dispose(): void;
}

export interface PreparedRendererCommit<Result> {
  readonly result: Result;
  commit(): void;
  discard(): void;
}

export interface TransformUpdate<Transform extends object> {
  readonly transform: Transform;
}

/** Adapter-side decoder: stages retained host objects; it does not submit a host render pass. */
export interface GlyphRenderer<Bindings extends AnyGlyphBindings, Result> {
  decode(view: CommandBufferView<Bindings>): PreparedRendererCommit<Result>;
  syncTransforms(updates: readonly TransformUpdate<Bindings['transform']>[]): void;
  dispose(): void;
}

export interface RendererContext<
  Bindings extends AnyGlyphBindings,
  Result = unknown,
  CodecValue extends Codec = Codec,
> {
  readonly drawRoot: Bindings['drawRoot'];
  readonly signal: AbortSignal;
  readonly codec: CodecValue;
  /** Built-in renderer selected by an adapter before a config wrapper is applied. */
  readonly defaultRenderer?: GlyphRenderer<Bindings, Result>;
}

/**
 * Runs one borrowed publication transaction. Projection/decode failures discard candidate
 * state; once commit begins, binder state follows the committed host branch even if cleanup throws.
 */
export function applyGlyphPublication<Bindings extends AnyGlyphBindings, Result>(
  candidate: PlanCandidate,
  signal: AbortSignal,
  projector: GlyphDisplayListProjector<Bindings>,
  renderer: GlyphRenderer<Bindings, Result>,
): PlanAcceptance {
  if (signal.aborted) return { accepted: false, error: signal.reason };
  let source: BorrowedTypedCommandBuffer | undefined;
  let update: CommandBufferView<Bindings> | undefined;
  let prepared: PreparedRendererCommit<Result> | undefined;
  let commitStarted = false;
  try {
    source = projector.source(candidate, signal);
    update = projector.project(source);
    prepared = renderer.decode(update);
    commitStarted = true;
    prepared.commit();
    projector.settle(source, update, true);
    return { accepted: true };
  } catch (error) {
    try {
      prepared?.discard();
    } catch {
      // Preserve the decode, preparation, or commit failure as the target rejection.
    }
    if (source !== undefined) {
      try {
        projector.settle(source, update, commitStarted);
      } catch {
        // Preserve the renderer failure if projection settlement also fails.
      }
    }
    return { accepted: false, error };
  }
}

/** Renderer-defined publication root selected through one configured handle. */
export interface GlyphRoot {
  /** Stable customization label. `undefined` denotes the handle's anonymous root. */
  readonly name: string | undefined;
  /** Owning configured handle. The anonymous root returns the handle itself. */
  readonly handle: GlyphHandle;
  readonly disposed: boolean;
  dispose(): void;
}

/** Root-owned lifecycle of one named adapter handle and its idempotent publication roots. */
export type GlyphHandle<Root extends GlyphRoot = GlyphRoot> = ((name: string) => Root) &
  Root & {
    /** Returns the idempotent named root. The handle itself fronts its anonymous default root. */
    readonly name: undefined;
    /** The anonymous root is already the handle, so ownership is reflexive here. */
    readonly handle: GlyphHandle<Root>;
    readonly disposed: boolean;
    dispose(): void;
  };

/** One adapter-authored formatted span before core interns its renderer identities. */
export interface GlyphTextSpan<Technique extends AnyRasterTechnique, MaterialInput> {
  readonly start: number;
  readonly end: number;
  readonly font?: FontSelection<Technique>;
  readonly material?: MaterialInput;
  readonly style?: TextStyle;
}

/** Adapter-authored formatted content accepted by a root Text controller. */
export interface GlyphFormattedText<Technique extends AnyRasterTechnique, MaterialInput> {
  readonly text: string;
  readonly spans: readonly GlyphTextSpan<Technique, MaterialInput>[];
}

/** Complete desired Text state; adapters own partial-update and inheritance semantics above it. */
export interface GlyphTextState<Technique extends AnyRasterTechnique, MaterialInput, TransformInput> {
  readonly font: FontSelection<Technique>;
  readonly text: string | GlyphFormattedText<Technique, MaterialInput>;
  readonly transform: TransformInput;
  readonly material?: MaterialInput;
  readonly order?: number;
  readonly rasterPixelRatio?: number;
  readonly style?: TextStyle;
  readonly layout?: ParagraphLayout;
  readonly constraints?: Constraints;
}

/** Narrow integration controller held privately by an adapter's Text object. */
export interface GlyphTextController<Technique extends AnyRasterTechnique, MaterialInput, TransformInput> {
  readonly disposed: boolean;
  update(state: GlyphTextState<Technique, MaterialInput, TransformInput>): void;
  measure(): ParagraphLayoutSummary;
  inspect(): GlyphLayoutInspection;
  dispose(): void;
}

/** Core-owned shaping/publication services scoped to exactly one anonymous or named root. */
export interface GlyphRootServices<Bindings extends AnyGlyphBindings, RendererResult, Boundary = unknown> {
  createText<Technique extends AnyRasterTechnique>(
    state: GlyphTextState<Technique, Bindings['materialInput'], Bindings['transformInput']>,
  ): GlyphTextController<Technique, Bindings['materialInput'], Bindings['transformInput']>;
  shape(options?: RenderPlannerPublishOptions): RendererResult;
  syncTransforms(): void;
  copy(
    text: GlyphTextController<AnyRasterTechnique, Bindings['materialInput'], Bindings['transformInput']>,
    request: GlyphCopyRequest,
    destination: GlyphCopyDestination<Bindings, RendererResult, Boundary>,
  ): GlyphCopy<RendererResult>;
}

export type GlyphCopyRequest =
  | Readonly<{ kind: 'glyphs'; stableIds: ArrayLike<number> }>
  | Readonly<{ kind: 'decorations' }>;

export interface GlyphCopyDestination<Bindings extends AnyGlyphBindings, RendererResult, Boundary> {
  readonly boundary: Boundary;
  readonly renderer: GlyphRenderer<Bindings, RendererResult>;
}

/** Retained destination produced by copying one committed Text subset. */
export interface GlyphCopy<RendererResult> {
  readonly result: RendererResult;
  syncTransforms(): void;
  dispose(): void;
}

/** Initial capacities for core's root-owned synchronous publication planner. */
export interface GlyphCommandCapacity {
  readonly limits: RenderPlannerLimits;
  readonly requestBytes: number;
  readonly resultBytes: number;
  readonly textUnits: number;
}

/** Adapter-provided host boundary used to finish one core-owned publication root. */
export interface GlyphRootCreateOptions<Bindings extends AnyGlyphBindings, RendererResult, Boundary> {
  readonly boundary: Boundary;
  readonly defaultRenderer?: GlyphRenderer<Bindings, RendererResult>;
  readonly dispose?: () => void;
}

/** Exact immutable config surface visible while one adapter root is constructed. */
export type SelectedGlyphConfig<
  Bindings extends AnyGlyphBindings,
  RendererResult,
  PortableResource,
  FontTechniques extends { readonly [Key in keyof FontTechniques]: AnyRasterTechnique },
  Boundary,
  CodecValue extends Codec,
  ConfigExtension extends object,
> = Readonly<ConfigExtension> & {
  readonly schema: GlyphSchema<Bindings, Boundary>;
  readonly fonts?: GlyphFontConfig<FontTechniques>;
  readonly commands?: Partial<GlyphCommandCapacity>;
  encode(context: EncodeContext): CodecValue;
  resolve(context: ResolveContext<PortableResource, Bindings['resource']>): ResourceLease<Bindings['resource']>;
  renderer(context: RendererContext<Bindings, RendererResult, CodecValue>): GlyphRenderer<Bindings, RendererResult>;
};

/** Two-phase root construction breaks the services/root/boundary cycle without exposing internals. */
export interface GlyphRootRecipeContext<
  Bindings extends AnyGlyphBindings,
  RendererResult,
  Boundary,
  CodecValue extends Codec = Codec,
  Config extends object = object,
> {
  readonly name: string | undefined;
  readonly codec: CodecValue;
  readonly config: Config;
  readonly fonts: GlyphHandleFonts | undefined;
  readonly services: GlyphRootServices<Bindings, RendererResult, Boundary>;
  create<Extension extends object>(
    extension: Extension,
    options: GlyphRootCreateOptions<Bindings, RendererResult, Boundary>,
  ): Extension & GlyphRoot;
}

/** Config recipe for the anonymous root and every idempotent named root. */
export interface GlyphRootRecipe<
  Root extends GlyphRoot,
  Bindings extends AnyGlyphBindings,
  RendererResult,
  Boundary,
  CodecValue extends Codec = Codec,
  Config extends object = object,
> {
  create(context: GlyphRootRecipeContext<Bindings, RendererResult, Boundary, CodecValue, Config>): Root;
}

/** Runtime-owned FontFace state made available to one configured renderer handle. */
export interface GlyphHandleFonts {
  isLoaded(selection: AnyFontFaceSelection): boolean;
  load(selection: AnyFontFaceSelection): Promise<AnyFontFaceSelection>;
  acquire<Technique extends AnyRasterTechnique>(selection: AnyFontFaceSelection): Font<Technique>;
  /** Borrow the store-owned immutable source. Callers must not dispose this value. */
  peek(selection: AnyFontFaceSelection): Font<AnyRasterTechnique>;
}

interface GlyphHandleFactoryInput {
  readonly name: string;
  readonly engine: GlyphEngine;
  readonly fonts: GlyphHandleFonts | undefined;
  readonly released: (handle: GlyphHandle) => void;
}

type GlyphConfigContractKey = 'schema' | 'fonts' | 'encode' | 'resolve' | 'renderer' | 'root' | 'commands';

type GlyphConfigExtensionValue<ConfigExtension extends object> = {
  readonly [Key in keyof ConfigExtension as Key extends GlyphConfigContractKey ? never : Key]: ConfigExtension[Key];
};

/** Handle-relative technique keys used to resolve FontFace format declarations. */
export interface GlyphFontConfig<Techniques extends { readonly [Key in keyof Techniques]: AnyRasterTechnique }> {
  readonly default: Extract<keyof Techniques, string>;
  readonly techniques: Techniques;
  /** Finish adapter-specific technique activation before a FontFace load becomes observable. */
  loadTechnique?(technique: Techniques[keyof Techniques]): Promise<void>;
}

interface AnyGlyphFontConfig {
  readonly default: string;
  readonly techniques: Readonly<object>;
  loadTechnique?(technique: AnyRasterTechnique): Promise<void>;
}

interface GlyphConfigContract<
  Root extends GlyphRoot,
  Bindings extends AnyGlyphBindings,
  RendererResult,
  PortableResource = unknown,
  FontTechniques extends { readonly [Key in keyof FontTechniques]: AnyRasterTechnique } = Readonly<
    Record<string, AnyRasterTechnique>
  >,
  Boundary = unknown,
  CodecValue extends Codec = Codec,
  ConfigExtension extends object = object,
> {
  readonly [glyphConfigBrand]: true;
  readonly [glyphConfigRootType]?: () => Root;
  readonly schema: GlyphSchema<Bindings, Boundary>;
  readonly fonts?: GlyphFontConfig<FontTechniques>;
  readonly commands?: Partial<GlyphCommandCapacity>;
  readonly root: GlyphRootRecipe<
    Root,
    Bindings,
    RendererResult,
    Boundary,
    CodecValue,
    SelectedGlyphConfig<
      Bindings,
      RendererResult,
      PortableResource,
      FontTechniques,
      Boundary,
      CodecValue,
      ConfigExtension
    >
  >;
  encode(context: EncodeContext): CodecValue;
  resolve(context: ResolveContext<PortableResource, Bindings['resource']>): ResourceLease<Bindings['resource']>;
  renderer(context: RendererContext<Bindings, RendererResult, CodecValue>): GlyphRenderer<Bindings, RendererResult>;
}

export type GlyphConfig<
  Root extends GlyphRoot,
  Bindings extends AnyGlyphBindings,
  RendererResult,
  PortableResource = unknown,
  FontTechniques extends { readonly [Key in keyof FontTechniques]: AnyRasterTechnique } = Readonly<
    Record<string, AnyRasterTechnique>
  >,
  Boundary = unknown,
  CodecValue extends Codec = Codec,
  ConfigExtension extends object = object,
> = GlyphConfigContract<
  Root,
  Bindings,
  RendererResult,
  PortableResource,
  FontTechniques,
  Boundary,
  CodecValue,
  ConfigExtension
> &
  Readonly<ConfigExtension> &
  GlyphConfigHandleFactory;

interface GlyphConfigHandleFactory {
  [glyphConfigHandleFactory]<Config extends this>(
    config: Config,
    input: GlyphHandleFactoryInput,
  ): GlyphConfigHandle<Config>;
}

/** Minimal covariant surface the root runtime needs to construct an inferred handle. */
export interface AnyGlyphConfig {
  readonly [glyphConfigBrand]: true;
  readonly fonts?: AnyGlyphFontConfig;
  [glyphConfigHandleFactory]<Config extends this>(
    config: Config,
    input: GlyphHandleFactoryInput,
  ): GlyphConfigHandle<Config>;
}

/** @internal Invokes the core-owned configured-handle constructor packaged by defineGlyphConfig. */
export function invokeGlyphConfigHandleFactory<Config extends AnyGlyphConfig>(
  config: Config,
  input: GlyphHandleFactoryInput,
): GlyphConfigHandle<Config> {
  if (typeof config[glyphConfigHandleFactory] !== 'function') {
    throw new TypeError('Glyph handle config must be created by defineGlyphConfig()');
  }
  return config[glyphConfigHandleFactory](config, input);
}

export type GlyphConfigHandle<Config> = Config extends {
  readonly [glyphConfigRootType]?: () => infer Root;
}
  ? Root extends GlyphRoot
    ? GlyphHandle<Root>
    : never
  : never;

export function defineGlyphConfig<
  Root extends GlyphRoot,
  Bindings extends AnyGlyphBindings,
  RendererResult,
  PortableResource = unknown,
  FontTechniques extends { readonly [Key in keyof FontTechniques]: AnyRasterTechnique } = Readonly<
    Record<string, AnyRasterTechnique>
  >,
  Boundary = unknown,
  CodecValue extends Codec = Codec,
  const Input extends object = object,
>(
  config: Omit<
    GlyphConfigContract<
      Root,
      Bindings,
      RendererResult,
      PortableResource,
      FontTechniques,
      Boundary,
      CodecValue,
      GlyphConfigExtensionValue<Input>
    >,
    typeof glyphConfigBrand
  > &
    Readonly<Input>,
): GlyphConfig<
  Root,
  Bindings,
  RendererResult,
  PortableResource,
  FontTechniques,
  Boundary,
  CodecValue,
  GlyphConfigExtensionValue<Input>
> {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new TypeError('GlyphConfig must be an object');
  }
  for (const key of ['encode', 'resolve', 'renderer'] as const) {
    if (typeof config[key] !== 'function') throw new TypeError(`GlyphConfig.${key} must be a function`);
  }
  if (typeof config.schema !== 'object' || config.schema === null) {
    throw new TypeError('GlyphConfig.schema must be an object');
  }
  if (typeof config.root !== 'object' || config.root === null || typeof config.root.create !== 'function') {
    throw new TypeError('GlyphConfig.root must define create');
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
  type DefinedConfig = GlyphConfig<
    Root,
    Bindings,
    RendererResult,
    PortableResource,
    FontTechniques,
    Boundary,
    CodecValue,
    GlyphConfigExtensionValue<Input>
  >;
  let defined: DefinedConfig;
  const createHandle = <Config extends DefinedConfig>(selected: Config, input: GlyphHandleFactoryInput) =>
    createConfiguredGlyphHandle(input, selected);
  // This constructor is the sole witness that joins inferred extension fields to the validated config contract.
  defined = Object.freeze({
    ...config,
    [glyphConfigBrand]: true as const,
    [glyphConfigHandleFactory]: createHandle,
  }) as unknown as DefinedConfig;
  return defined;
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
