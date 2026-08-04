import type { RegisteredFont } from './font.js';
import type { ParagraphLayout } from './layout.js';
import type { FontHandle, FontSlot, RasterHandle, RasterKey, Sha256Hex } from './identity.js';
import type { BakeProgressListener, RasterBakeArtifact } from './bake.js';
import type { GlyphPaint } from './paint.js';

export type RasterKind = string;

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type RasterOptionsArgument<Options> = [Options] extends [never] ? undefined : Options;

type RasterOptionsOptional<Options> = [Options] extends [never] ? true : undefined extends Options ? true : false;

export type StaticNumberTuple<Values extends readonly [number, ...number[]]> = number extends Values[number]
  ? never
  : Values;

export type RasterSource =
  | { readonly type: 'embedded' }
  | {
      readonly type: 'external';
      readonly uri: string;
      readonly artifactHash: Sha256Hex;
    }
  | {
      readonly type: 'external';
      readonly uri?: never;
      readonly artifactHash?: Sha256Hex;
    };

export interface RasterReference<Kind extends string = string> {
  readonly rasterKey: RasterKey;
  readonly kind: Kind;
  readonly extension: string;
  readonly version: number;
  readonly source: RasterSource;
}

export type RasterResourceSource =
  | { readonly type: 'bufferView'; readonly bufferView: number }
  | {
      readonly type: 'external';
      readonly uri: string;
      readonly byteLength: number;
      readonly artifactHash: Sha256Hex;
    };

export interface RasterSelection<Kind extends string = string> {
  readonly rasterKey: RasterKey | string;
  readonly kind?: Kind;
}

export interface RegisteredRaster<Kind extends string = string> {
  readonly rasterKey: RasterKey;
  readonly handle: RasterHandle;
  readonly font: FontHandle;
  readonly kind: Kind;
  readonly extension: string;
  readonly version: number;
  /** Validated companion-extension JSON owned semantically by the raster module. */
  readonly extensionData: JsonValue;
  /** Return a bounds-checked immutable view of an artifact bufferView. */
  view(bufferView: number): Uint8Array;
  /** Resolve an embedded or authenticated external extension resource. */
  resource(source: RasterResourceSource, signal?: AbortSignal): Promise<Uint8Array>;
  dispose(): void;
}

export interface RasterLoadOptions {
  readonly resolve?: RasterResolver;
  readonly resolveResource?: RasterResourceResolver;
  readonly signal?: AbortSignal;
}

export interface RasterResolverContext {
  readonly font: RegisteredFont;
  readonly reference: RasterReference;
  readonly signal?: AbortSignal;
}

export type RasterResolver = (context: RasterResolverContext) => Promise<ArrayBufferView | undefined>;

export interface RasterResourceResolverContext {
  readonly font: RegisteredFont;
  readonly reference: RasterReference;
  readonly source: Extract<RasterResourceSource, { readonly type: 'external' }>;
  readonly signal?: AbortSignal;
}

export type RasterResourceResolver = (context: RasterResourceResolverContext) => Promise<ArrayBufferView | undefined>;

interface RuntimeRasterBakeRequestBase {
  readonly source: Uint8Array;
  readonly font: RegisteredFont;
  readonly fontFaceIndex: number;
  readonly rasterKey: RasterKey | string;
  readonly signal?: AbortSignal;
  readonly onProgress?: BakeProgressListener;
}

export type RuntimeRasterBakeRequest<Options> = RuntimeRasterBakeRequestBase &
  ([Options] extends [never] ? { readonly options?: never } : { readonly options: Options });

export interface RuntimeRasterBakerModule<Kind extends string, Options> {
  readonly kind: Kind;
  bake(request: RuntimeRasterBakeRequest<Options>): Promise<RasterBakeArtifact<Kind>>;
}

export type RuntimeRasterBakerLoader<Kind extends string, Options> = () => Promise<
  RuntimeRasterBakerModule<Kind, Options> | { readonly default: RuntimeRasterBakerModule<Kind, Options> }
>;

export interface RasterModule<Kind extends string, Resource, DrawBatch extends RasterDrawBatch, Options = never> {
  readonly kind: Kind;
  readonly extension: string;
  readonly version: number;
  readonly runtimeBaker?: RuntimeRasterBakerLoader<Kind, Options>;

  descriptor(options: RasterOptionsArgument<Options>): JsonValue;

  decode(font: RegisteredFont, raster: RegisteredRaster<Kind>, signal?: AbortSignal): Promise<Resource>;

  prepare(layout: ParagraphLayout, resource: Resource, fontSlot: FontSlot, signal?: AbortSignal): void | Promise<void>;
  /**
   * Stage one complete renderer-owned batch generation. The implementation must not mutate
   * `previous` before commit and must release partial allocations before throwing. Each stage
   * owns its unpublished state independently: aborting one candidate must not affect another
   * candidate staged concurrently against the same `previous` batch.
   */
  stageBatch(
    previous: DrawBatch | undefined,
    layout: ParagraphLayout,
    resource: Resource,
    fontSlot: FontSlot,
    paint: GlyphPaint,
    rasterPixelRatio: number,
  ): RasterBatchStage<DrawBatch>;
  validatePaint?(paint: GlyphPaint): void;
  dispose(resource: Resource): void;
}

// Deliberately erase every module parameter at heterogeneous token/cache boundaries.
// Keeping `Kind` as `string` makes the mutable-in-position module surface invariant,
// so a concrete `RasterModule<'bitmap', ...>` no longer satisfies this erasure.
export type AnyRasterModule = RasterModule<any, any, any, any>;

export type RasterKindOf<Module extends AnyRasterModule> =
  Module extends RasterModule<infer Kind, any, any, any> ? Kind : never;

export type RasterResourceOf<Module extends AnyRasterModule> =
  Module extends RasterModule<any, infer Resource, any, any> ? Resource : never;

export type RasterBatchOf<Module extends AnyRasterModule> =
  Module extends RasterModule<any, any, infer DrawBatch, any> ? DrawBatch : never;

export type RasterOptionsOf<Module extends AnyRasterModule> =
  Module extends RasterModule<any, any, any, infer Options> ? Options : never;

type RasterRequestBase<Module extends AnyRasterModule> = {
  readonly module: Module;
};

export type RasterRequest<Module extends AnyRasterModule> = RasterRequestBase<Module> &
  ([RasterOptionsOf<Module>] extends [never]
    ? { readonly options?: never }
    : undefined extends RasterOptionsOf<Module>
      ? { readonly options?: RasterOptionsOf<Module> }
      : { readonly options: RasterOptionsOf<Module> });

export type RasterInput<Module extends AnyRasterModule> =
  RasterOptionsOptional<RasterOptionsOf<Module>> extends true ? Module | RasterRequest<Module> : RasterRequest<Module>;

export type AnyRasterInput =
  | AnyRasterModule
  | {
      readonly module: AnyRasterModule;
      readonly options?: unknown;
    };

export interface LoadedRaster<Module extends AnyRasterModule> {
  readonly module: Module;
  readonly artifact: RegisteredRaster<RasterKindOf<Module>>;
  readonly resource: RasterResourceOf<Module>;
}

/** Renderer-neutral ownership surface implemented by every raster-owned batch. */
export interface RasterDrawBatch {
  /** Release all renderer resources owned by this batch. Safe to call repeatedly. */
  dispose(): void;
}

/** Renderer adapter batch that publishes one host-owned scene object. */
export interface RasterObjectDrawBatch<SceneObject> extends RasterDrawBatch {
  readonly object: SceneObject;
  /** Synchronously and infallibly apply the owning object's order while preserving draw-local ordering. */
  setRenderOrderBase(base: number): void;
}

/**
 * One unpublished raster generation. The target may retain `previous` or replace it, but staging
 * must not mutate committed state. Commit is synchronous and infallible; abort is idempotent and
 * becomes a no-op after commit transfers batch ownership to the caller.
 */
export interface RasterBatchStage<DrawBatch extends RasterDrawBatch = RasterDrawBatch> {
  readonly batch: DrawBatch;
  /** Publish the fully validated stage. Safe to call repeatedly. */
  commit(): void;
  /** Release an unpublished stage without touching the live batch. Safe to call repeatedly. */
  abort(): void;
}

/** Build the required one-shot ownership state machine around a package-owned staged update. */
export function defineRasterBatchStage<DrawBatch extends RasterDrawBatch>(
  batch: DrawBatch,
  publish: () => void,
  release: () => void,
): RasterBatchStage<DrawBatch> {
  let state: 'staged' | 'committed' | 'aborted' = 'staged';
  return {
    batch,
    commit() {
      if (state !== 'staged') return;
      state = 'committed';
      publish();
    },
    abort() {
      if (state !== 'staged') return;
      state = 'aborted';
      release();
    },
  };
}

export function defineRaster<const Kind extends string, Resource, DrawBatch extends RasterDrawBatch, Options = never>(
  module: RasterModule<Kind, Resource, DrawBatch, Options>,
): RasterModule<Kind, Resource, DrawBatch, Options> {
  return module;
}
