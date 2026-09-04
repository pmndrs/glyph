import type { Font } from '../font.js';
import type { FontFaceRasterOf, FontFaceSelection } from '../font-face.js';
import type { GlyphLayoutInspection, ParagraphLayoutSummary } from '../layout.js';
import type { FontSelection } from '../loaded-font.js';
import type { RasterFormatMetadata } from './raster-format.js';
import type { Constraints, ParagraphLayout, TextStyle } from '../text-properties.js';
import type { PortableResource } from './resources.js';
import type { CodecBuffer, CodecDescriptor, CodecIdFactory, CodecProgram } from './codec.js';
import type {
  BatchIdentity,
  ClipIdentity,
  InstanceIdentity,
  InstanceSpanIdentity,
  SemanticIdentity,
} from '../internal/typed-command-identity.js';

export type {
  BatchIdentity,
  ClipIdentity,
  InstanceIdentity,
  InstanceSpanIdentity,
  SemanticIdentity,
  TransformIdentity,
  TypedBuffer,
  TypedMaterial,
  TypedProgram,
  TypedResource,
} from '../internal/typed-command-identity.js';

/** One lazily projected borrowed sequence. Values expire with their command buffer. */
export interface BorrowedCommandSequence<Value> extends Iterable<Value> {
  readonly length: number;
  at(index: number): Value | undefined;
}

/** Ordered display-list record kinds emitted by the built-in Codec projection. */
export type GlyphInstanceKind = 'glyph' | 'decoration' | 'inline-object' | 'clip' | 'codec';

/** Renderer binding vocabulary selected by one GlyphConfig. */
export interface GlyphBindingSet {
  readonly resource: object;
  readonly buffer: object;
  readonly program: object;
  readonly material: object;
  readonly transform: object;
  readonly batch: object;
  readonly instance: object;
  readonly instanceSpan: object;
  /** Adapter-authored material value accepted by root Text state. */
  readonly materialInput: unknown;
  /** Adapter-authored transform value accepted by root Text state. */
  readonly transformInput: unknown;
}

export type GlyphBufferDeclaration = Readonly<{ kind: 'codec'; value: CodecBuffer }> | Readonly<{ kind: 'order' }>;

export interface GlyphBufferBindingInput<Program extends object> {
  readonly program: Program;
  readonly declaration: GlyphBufferDeclaration;
}

export interface GlyphInstanceSpanBindingInput<Resource extends object, Buffer extends object, Program extends object> {
  readonly identity: InstanceSpanIdentity;
  readonly kind: GlyphInstanceKind;
  readonly program: Program;
  readonly programVariant: number;
  readonly resource: Resource | undefined;
  readonly buffer: Buffer | undefined;
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

export interface GlyphDrawBindingInput<
  Resource extends object,
  Buffer extends object,
  Program extends object,
  Material extends object,
> {
  readonly program: Program;
  readonly programVariant: number;
  readonly material: Material | undefined;
  readonly buffers: BorrowedCommandSequence<Buffer>;
  readonly resources: BorrowedCommandSequence<Resource>;
  readonly flags: number;
  readonly clip: ClipIdentity | undefined;
  readonly depthKey: number;
  readonly order: number;
  readonly indirect: Readonly<{ buffer: Buffer; byteOffset: number }> | undefined;
}

export interface GlyphBatchBindingInput<
  Resource extends object,
  Buffer extends object,
  Program extends object,
  Material extends object,
  InstanceSpan extends object,
> extends GlyphDrawBindingInput<Resource, Buffer, Program, Material> {
  readonly identity: BatchIdentity;
  readonly instances: BorrowedCommandSequence<DisplayListInstanceSpan<InstanceSpan>>;
}

export interface GlyphRootInstanceBindingInput<
  Resource extends object,
  Buffer extends object,
  Program extends object,
  Material extends object,
  Transform extends object,
  InstanceSpan extends object,
> extends GlyphDrawBindingInput<Resource, Buffer, Program, Material> {
  readonly identity: InstanceIdentity;
  readonly transform: Transform | undefined;
  readonly instance: DisplayListInstanceSpan<InstanceSpan>;
}

/** Config-owned schema that binds trusted engine meanings to renderer payloads. */
export interface GlyphSchema<Bindings extends GlyphBindingSet, Boundary> {
  program(boundary: Boundary, program: CodecProgram): Bindings['program'];
  buffer(boundary: Boundary, input: GlyphBufferBindingInput<Bindings['program']>): Bindings['buffer'];
  material(boundary: Boundary, material: Bindings['materialInput']): Bindings['material'];
  transform(boundary: Boundary, transform: Bindings['transformInput'], recordIndex: number): Bindings['transform'];
  batch(
    boundary: Boundary,
    input: GlyphBatchBindingInput<
      Bindings['resource'],
      Bindings['buffer'],
      Bindings['program'],
      Bindings['material'],
      Bindings['instanceSpan']
    >,
  ): Bindings['batch'];
  instance(
    boundary: Boundary,
    input: GlyphRootInstanceBindingInput<
      Bindings['resource'],
      Bindings['buffer'],
      Bindings['program'],
      Bindings['material'],
      Bindings['transform'],
      Bindings['instanceSpan']
    >,
  ): Bindings['instance'];
  instanceSpan(
    boundary: Boundary,
    input: GlyphInstanceSpanBindingInput<Bindings['resource'], Bindings['buffer'], Bindings['program']>,
  ): Bindings['instanceSpan'];
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
  MaterialInput,
  TransformInput,
> = {
  readonly resource: Resource;
  readonly buffer: Buffer;
  readonly program: Program;
  readonly material: Material;
  readonly transform: Transform;
  readonly batch: Batch;
  readonly instance: Instance;
  readonly instanceSpan: InstanceSpan;
  readonly materialInput: MaterialInput;
  readonly transformInput: TransformInput;
};

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
  MaterialInput = Material,
  TransformInput = Transform,
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
      MaterialInput,
      TransformInput
    >,
    Boundary
  >,
): Readonly<typeof schema> {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    throw new TypeError('Glyph schema must be an object');
  }
  for (const key of ['program', 'buffer', 'material', 'transform', 'batch', 'instance', 'instanceSpan'] as const) {
    if (typeof schema[key] !== 'function') throw new TypeError(`Glyph schema ${key} must be a function`);
  }
  return Object.freeze({ ...schema });
}

/** Codec selected by `GlyphConfig.encode`; codec-named values remain an internal ABI detail. */
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

export interface ResolveContext<Previous extends object = object> {
  readonly format: string;
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
  readonly kind: GlyphInstanceKind;
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

export type DisplayListChild<Bindings extends GlyphBindingSet> =
  | DisplayListBatch<Bindings['batch'], Bindings['instanceSpan']>
  | DisplayListRootInstance<Bindings['instance'], Bindings['transform']>;

export interface DisplayList<Bindings extends GlyphBindingSet> {
  readonly transforms: BorrowedCommandSequence<DisplayListTransform<Bindings['transform']>>;
  readonly children: BorrowedCommandSequence<DisplayListChild<Bindings>>;
}

export interface DisplayListTransform<Transform extends object> {
  readonly value: Transform;
  /** Physical transform-table record selected by the Codec. */
  readonly recordIndex: number;
}

export type DisplayListPhase<Bindings extends GlyphBindingSet> =
  | Readonly<{ kind: 'unchanged' }>
  | Readonly<{ kind: 'replace'; value: DisplayList<Bindings> }>;

export type Retirement<Resource extends object, Buffer extends object> =
  | Readonly<{ kind: 'resource'; resource: Resource }>
  | Readonly<{ kind: 'buffer'; buffer: Buffer }>
  | Readonly<{ kind: 'slot-range'; byteOffset: number; byteLength: number }>
  | Readonly<{ kind: 'output-bytes'; byteOffset: number; byteLength: number }>;

export interface DisplayListChanges<Bindings extends GlyphBindingSet> {
  readonly resources: BorrowedCommandSequence<ResourceUpdate<Bindings['resource']>>;
  readonly buffers: BorrowedCommandSequence<BufferUpdate<Bindings['buffer'], Bindings['program']>>;
  readonly patches: BorrowedCommandSequence<BufferPatch<Bindings['buffer']>>;
  readonly retirements: BorrowedCommandSequence<Retirement<Bindings['resource'], Bindings['buffer']>>;
}

/** One phase-structured retained display-list update; references are typed bindings — numeric engine IDs and the wire representation stay private. */
export interface CommandBufferView<Bindings extends GlyphBindingSet> {
  readonly delivery: 'borrowed-command-buffer';
  readonly engineRevision: number;
  /** Monotonic revision of this root's Codec-produced command state. */
  readonly revision: number;
  readonly publicationGeneration: number;
  readonly checkpoint: boolean;
  readonly updates: DisplayListChanges<Bindings>;
  readonly displayList: DisplayListPhase<Bindings>;
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
export interface GlyphRenderer<Bindings extends GlyphBindingSet, Result> {
  decode(view: CommandBufferView<Bindings>): PreparedRendererCommit<Result>;
  syncTransforms(updates: readonly TransformUpdate<Bindings['transform']>[]): void;
  dispose(): void;
}

export interface RendererContext<
  Bindings extends GlyphBindingSet,
  Result = unknown,
  CodecValue extends Codec = Codec,
  Boundary = unknown,
> {
  /** Adapter-owned publication boundary captured by this root's renderer. */
  readonly boundary: Boundary;
  readonly signal: AbortSignal;
  readonly codec: CodecValue;
  /** Built-in renderer selected by an adapter before a config wrapper is applied. */
  readonly defaultRenderer?: GlyphRenderer<Bindings, Result>;
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

/** Terminal named root selected from a configured handle. */
export type GlyphNamedRoot<Root extends GlyphRoot> = Root & {
  readonly name: string;
  readonly handle: GlyphHandle<Root>;
};

/** Root-owned lifecycle of one named adapter handle and its idempotent publication roots. */
export type GlyphHandle<Root extends GlyphRoot = GlyphRoot> = ((name: string) => GlyphNamedRoot<Root>) &
  Root & {
    /** Returns the idempotent named root. The handle itself fronts its anonymous default root. */
    readonly name: undefined;
    /** The anonymous root is already the handle, so ownership is reflexive here. */
    readonly handle: GlyphHandle<Root>;
    readonly disposed: boolean;
    dispose(): void;
  };

/** One adapter-authored formatted span before core interns its renderer identities. */
export interface GlyphTextSpan<Format extends RasterFormatMetadata, MaterialInput> {
  readonly start: number;
  readonly end: number;
  readonly font?: FontSelection<Format>;
  readonly material?: MaterialInput;
  readonly style?: TextStyle;
}

/** Adapter-authored formatted content accepted by a root Text controller. */
export interface GlyphFormattedText<Format extends RasterFormatMetadata, MaterialInput> {
  readonly text: string;
  readonly spans: readonly GlyphTextSpan<Format, MaterialInput>[];
}

/** Complete desired Text state; adapters own partial-update and inheritance semantics above it. */
export interface GlyphTextState<Format extends RasterFormatMetadata, MaterialInput, TransformInput> {
  readonly font: FontSelection<Format>;
  readonly text: string | GlyphFormattedText<Format, MaterialInput>;
  readonly transform: TransformInput;
  readonly material?: MaterialInput;
  readonly order?: number;
  readonly rasterPixelRatio?: number;
  readonly style?: TextStyle;
  readonly layout?: ParagraphLayout;
  readonly constraints?: Constraints;
}

/** Narrow integration controller held privately by an adapter's Text object. */
export interface GlyphTextController<Format extends RasterFormatMetadata, MaterialInput, TransformInput> {
  readonly disposed: boolean;
  update(state: GlyphTextState<Format, MaterialInput, TransformInput>): void;
  measure(): ParagraphLayoutSummary;
  inspect(): GlyphLayoutInspection;
  dispose(): void;
}

/** Optional semantic products and compositing contract for the next `shape()` publication. */
export interface GlyphShapeOptions {
  readonly semanticViews?: 'none' | 'measurement' | 'layout-inspection' | 'all';
  readonly compositing?: 'ordered' | 'independent';
}

/** Core-owned shaping/publication services scoped to exactly one anonymous or named root. */
export interface GlyphRootServices<Bindings extends GlyphBindingSet, RendererResult, Boundary = unknown> {
  createText<Format extends RasterFormatMetadata>(
    state: GlyphTextState<Format, Bindings['materialInput'], Bindings['transformInput']>,
  ): GlyphTextController<Format, Bindings['materialInput'], Bindings['transformInput']>;
  /** Schedules root-owned semantic or presentation state for the next top-level `glyph.shape()`. */
  invalidate(): void;
  syncTransforms(): void;
  copy<Format extends RasterFormatMetadata>(
    text: GlyphTextController<Format, Bindings['materialInput'], Bindings['transformInput']>,
    request: GlyphCopyRequest,
    destination: GlyphCopyDestination<Bindings, RendererResult, Boundary>,
  ): GlyphCopy<RendererResult>;
}

/** Renderer-neutral lifecycle hooks surrounding one root's contribution to `glyph.shape()`. */
export interface GlyphRootShapeHooks<RendererResult> {
  /** Reconciles retained adapter state. Returning false defers this root until its next invalidation. */
  prepare?(): GlyphShapeOptions | false | undefined;
  /** Runs after the renderer accepted this root and the borrowed command buffer expired. */
  accepted?(result: RendererResult): void;
  /** Runs after this root failed without changing its last accepted renderer state. */
  rejected?(error: unknown): void;
}

export type GlyphCopyRequest =
  | Readonly<{ kind: 'glyphs'; stableIds: ArrayLike<number> }>
  | Readonly<{ kind: 'decorations' }>;

export interface GlyphCopyDestination<Bindings extends GlyphBindingSet, RendererResult, Boundary> {
  readonly boundary: Boundary;
  readonly renderer: GlyphRenderer<Bindings, RendererResult>;
}

/** Retained destination produced by copying one committed Text subset. */
export interface GlyphCopy<RendererResult> {
  readonly result: RendererResult;
  syncTransforms(): void;
  dispose(): void;
}

/** Fixed safety and capacity limits for one configured root's command publication. */
export interface GlyphCommandLimits {
  readonly maxParagraphs: number;
  readonly maxClusters: number;
  readonly maxLines: number;
  readonly maxRegions: number;
  readonly maxExclusions: number;
  readonly maxInlineObjects: number;
  readonly maxSlotsPerBand: number;
  readonly maxOutputBytes: number;
}

/** Initial capacities for one configured root's command publication. */
export interface GlyphCommandCapacity {
  readonly limits: GlyphCommandLimits;
  readonly requestBytes: number;
  readonly resultBytes: number;
  readonly textUnits: number;
}

/** Adapter-provided host boundary used to finish one core-owned publication root. */
export interface GlyphRootCreateOptions<Bindings extends GlyphBindingSet, RendererResult, Boundary> {
  readonly boundary: Boundary;
  readonly defaultRenderer?: GlyphRenderer<Bindings, RendererResult>;
  readonly shape?: GlyphRootShapeHooks<RendererResult>;
  readonly dispose?: () => void;
}

/** Exact immutable config surface visible while one adapter root is constructed. */
export type SelectedGlyphConfig<
  Bindings extends GlyphBindingSet,
  RendererResult,
  Boundary,
  CodecValue extends Codec,
  FontFormats extends object = object,
> = {
  readonly schema: GlyphSchema<Bindings, Boundary>;
  readonly fonts?: GlyphFontConfigValue<FontFormats>;
  readonly commands?: Partial<GlyphCommandCapacity>;
  encode(context: EncodeContext): CodecValue;
  resolve(context: ResolveContext<Bindings['resource']>): ResourceLease<Bindings['resource']>;
  renderer(
    context: RendererContext<Bindings, RendererResult, CodecValue, Boundary>,
  ): GlyphRenderer<Bindings, RendererResult>;
};

/** Two-phase root construction breaks the services/root/boundary cycle without exposing internals. */
export interface GlyphRootRecipeContext<
  Bindings extends GlyphBindingSet,
  RendererResult,
  Boundary,
  CodecValue extends Codec = Codec,
> {
  readonly name: string | undefined;
  readonly codec: CodecValue;
  readonly config: SelectedGlyphConfig<Bindings, RendererResult, Boundary, CodecValue>;
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
  Bindings extends GlyphBindingSet,
  RendererResult,
  Boundary,
  CodecValue extends Codec = Codec,
> {
  create(context: GlyphRootRecipeContext<Bindings, RendererResult, Boundary, CodecValue>): Root;
}

/** Runtime-owned FontFace state made available to one configured renderer handle. */
export interface GlyphHandleFonts {
  isLoaded<const Selection extends FontFaceSelection>(selection: Selection): boolean;
  load<const Selection extends FontFaceSelection>(selection: Selection): Promise<Selection>;
  acquire<const Selection extends FontFaceSelection>(selection: Selection): Font<FontFaceRasterOf<Selection>>;
  /** Borrow the store-owned immutable source. Callers must not dispose this value. */
  peek<const Selection extends FontFaceSelection>(selection: Selection): Font<FontFaceRasterOf<Selection>>;
}

type GlyphFontFormats<Formats extends object> = Readonly<{
  [Key in keyof Formats]: Formats[Key] extends RasterFormatMetadata ? Formats[Key] : never;
}>;

/** Handle-relative format keys used to resolve FontFace format declarations. */
type GlyphFontFormatKey<Formats extends object> = [keyof Formats] extends [never]
  ? string
  : Extract<keyof Formats, string>;
export interface GlyphFontConfig<Formats extends object> {
  readonly default: GlyphFontFormatKey<Formats>;
  readonly formats: GlyphFontFormats<Formats>;
}

interface GlyphFontConfigValue<Formats extends object> {
  readonly default: string;
  readonly formats: GlyphFontFormats<Formats>;
}

interface GlyphConfigContract<
  Root extends GlyphRoot,
  Bindings extends GlyphBindingSet,
  RendererResult,
  FontFormats extends object = object,
  Boundary = unknown,
  CodecValue extends Codec = Codec,
> {
  readonly schema: GlyphSchema<Bindings, Boundary>;
  readonly fonts?: GlyphFontConfig<FontFormats>;
  readonly commands?: Partial<GlyphCommandCapacity>;
  readonly root: GlyphRootRecipe<Root, Bindings, RendererResult, Boundary, CodecValue>;
  encode(context: EncodeContext): CodecValue;
  resolve(context: ResolveContext<Bindings['resource']>): ResourceLease<Bindings['resource']>;
  renderer(
    context: RendererContext<Bindings, RendererResult, CodecValue, Boundary>,
  ): GlyphRenderer<Bindings, RendererResult>;
}

export type GlyphConfig<
  Root extends GlyphRoot,
  Bindings extends GlyphBindingSet,
  RendererResult,
  FontFormats extends object = object,
  Boundary = unknown,
  CodecValue extends Codec = Codec,
> = GlyphConfigContract<Root, Bindings, RendererResult, FontFormats, Boundary, CodecValue>;

export type GlyphConfigHandle<Config> = Config extends {
  readonly root: { create(...args: never[]): infer Root extends GlyphRoot };
}
  ? GlyphHandle<Root>
  : never;

/** Complete renderer binding vocabulary projected from one inferred GlyphConfig declaration. */
export type GlyphConfigBindings<Config> = Config extends {
  readonly schema: GlyphSchema<infer Bindings, infer _Boundary>;
}
  ? Bindings
  : never;

/** Nameable config contract derived from a schema for isolated declaration boundaries. */
export type GlyphConfigFor<
  Schema extends object,
  Root extends GlyphRoot,
  RendererResult,
  CodecValue extends Codec = Codec,
  FontFormats extends object = object,
> =
  Schema extends GlyphSchema<infer Bindings, infer Boundary>
    ? GlyphConfig<Root, Bindings, RendererResult, FontFormats, Boundary, CodecValue>
    : never;

export function defineGlyphConfig<
  Root extends GlyphRoot,
  Bindings extends GlyphBindingSet,
  RendererResult,
  FontFormats extends object,
  Boundary,
  CodecValue extends Codec,
>(
  config: GlyphConfigContract<Root, Bindings, RendererResult, FontFormats, Boundary, CodecValue>,
): GlyphConfig<Root, Bindings, RendererResult, FontFormats, Boundary, CodecValue> {
  return config;
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
