import { alignSpansToClusters } from '../formatted-text.js';
import { textShaperAbi } from '../generated/text-shaper-abi.js';
import { copyGlyphLayoutInspection, type GlyphLayoutInspection, type ParagraphLayoutSummary } from '../layout.js';
import {
  assertConstraints,
  assertParagraphLayout,
  assertTextStyle,
  assertTextStyleFeatureRanges,
  type Constraints,
  type ParagraphLayout,
  type TextStyle,
} from '../text-properties.js';
import { createExactFrameBufferPool, type ExactFrameBufferPool } from '../internal/frame-transfer-pool.js';
import {
  compileEngineGeometry,
  assertTextEffectsSupported,
  engineStyleId,
  engineStyleValue,
  minimalTextMutation,
  normalizedColumns,
} from '../engine-encoding.js';
import {
  compilePlannerFrameUpdate,
  MAX_TEXT_ENGINE_OUTPUT_BYTES,
  type PlannerConstraint,
  type PlannerExclusion,
  type PlannerFrameLimits,
  type PlannerInlineObject,
  type PlannerParagraphMutation,
  type PlannerRegion,
  type PlannerStyleMutation,
  validatePlannerFrameRecords,
} from './frame-wire.js';
import type {
  HandleFontStackBinding,
  HandleMaterialBinding,
  HandleBindingLease,
  CodecRegistration,
  HandleResourceBinding,
  HandleTransformBinding,
  GlyphHandleState,
  PlanPublication,
  PlanTransport,
} from '../internal/handle-state.js';
import {
  RenderPlanView,
  readTrustedRenderPlanResourceReferenceId,
  type RenderPlanTable,
  type RenderPlanTransformId,
} from './plan-view.js';
import { readPlannerLayouts, readPlannerMeasurements } from './layout-query-view.js';
import type { PortableResource } from './portable-resources.js';
import {
  policyCapabilitySetSelectionId,
  selectPolicyCapabilitySet,
  type MaterialHandle,
  type ParagraphId,
  type PolicyCapabilitySet,
  type ResourceHandle,
} from './render-policy.js';

const MAX_U32 = 0xffff_ffff;
const claimedTargets = new WeakSet<object>();

declare const planOriginBrand: unique symbol;
/** Unforgeable identity of the plan that produced a plan candidate. */
export interface PlanOrigin {
  readonly [planOriginBrand]: true;
}

declare const payloadIdentityBrand: unique symbol;
/** Unforgeable identity of one retained portable payload. */
export interface PortablePayloadIdentity {
  readonly [payloadIdentityBrand]: true;
}

/** A table carried by every renderer-neutral plan publication. */
export type RenderPlanTableName =
  | 'resources'
  | 'buffers'
  | 'patches'
  | 'primitives'
  | 'draws'
  | 'retirements'
  | 'diagnostics';

/** Bounds-checked scalar and byte access over one validated render plan. */
export interface RenderPlanReader {
  table(name: RenderPlanTableName): RenderPlanTable;
  record(table: RenderPlanTable, index: number): number;
  u8(offset: number): number;
  u16(offset: number): number;
  u32(offset: number): number;
  f32(offset: number): number;
  bytes(offset: number, byteLength: number): Uint8Array;
}

/** A synchronous view into engine-owned A/B memory. */
export interface BorrowedRenderPlan extends RenderPlanReader {
  readonly delivery: 'borrowed';
}

/** A self-owned render-plan view that may cross an asynchronous boundary. */
export interface OwnedRenderPlan extends RenderPlanReader {
  readonly delivery: 'owned';
}

/** One renderer-neutral payload resolved from a plan resource reference. */
export interface ResolvedPortablePayload {
  readonly referenceId: ResourceHandle;
  readonly identity: PortablePayloadIdentity;
  readonly resourceName: string;
  readonly payload: PortableResource;
}

/** A counted claim on a portable payload and its singleton companions. */
export interface PortablePayloadLease extends ResolvedPortablePayload {
  readonly techniqueId: string;
  /** Selected payload plus every singleton companion declared by the same compiled font. */
  readonly resources: readonly ResolvedPortablePayload[];
  readonly disposed: boolean;
  dispose(): void;
}

/** One self-owned payload delivered with an asynchronous plan candidate. */
export interface ResolvedPlanPayload extends ResolvedPortablePayload {
  readonly techniqueId: string;
  readonly resources: readonly ResolvedPortablePayload[];
}

/** A plan transform resolved to its handle-owned binding. */
export interface ResolvedPlanTransform {
  /** Physical transform-table record consumed by indexed renderer buffers. */
  readonly transformIndex: RenderPlanTransformId;
  /** Optional root draw identity that selects the same host transform without entering the transform table. */
  readonly instanceId?: RenderPlanTransformId;
  readonly binding: HandleTransformBinding;
}

/** A synchronous candidate whose borrowed plan must be consumed during `accept`. */
export interface PlanCandidate {
  readonly origin: PlanOrigin;
  readonly plan: BorrowedRenderPlan;
  readonly engineRevision: number;
  readonly planRevision: number;
  readonly publicationGeneration: number;
  /** Whether this publication is a complete renderer checkpoint rather than an incremental update. */
  readonly checkpoint: boolean;
  readonly transforms: readonly ResolvedPlanTransform[];
  acquirePayload(referenceId: ResourceHandle): PortablePayloadLease;
  resolveMaterial(materialId: MaterialHandle): HandleMaterialBinding;
  resolveResource(resourceId: ResourceHandle): HandleResourceBinding;
}

/** A self-owned candidate suitable for a worker or deferred renderer. */
export interface AsyncPlanCandidate {
  readonly origin: PlanOrigin;
  readonly plan: OwnedRenderPlan;
  readonly engineRevision: number;
  readonly planRevision: number;
  readonly publicationGeneration: number;
  /** Whether this publication is a complete renderer checkpoint rather than an incremental update. */
  readonly checkpoint: boolean;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly payloads: readonly ResolvedPlanPayload[];
  readonly transforms: readonly ResolvedPlanTransform[];
}

/** The renderer's transactional decision for one candidate. */
export type PlanAcceptance = Readonly<{ accepted: true }> | Readonly<{ accepted: false; error: unknown }>;

/** An asynchronous target decision that returns ownership of the transfer buffer. */
export type AsyncPlanTargetResult =
  | Readonly<{ accepted: true; returnedBytes: Uint8Array<ArrayBuffer> }>
  | Readonly<{ accepted: false; error: unknown; returnedBytes?: Uint8Array<ArrayBuffer> }>;

/** Renderer-to-plan control channel for requesting a complete checkpoint. */
export interface PlanTargetControl {
  requestCheckpoint(): void;
}

/** Synchronous zero-copy render-plan target; this is the normal same-realm path. */
export interface PlanTarget {
  readonly delivery: 'borrowed';
  accept(candidate: PlanCandidate, signal: AbortSignal): PlanAcceptance;
  dispose(): void;
}

/** Asynchronous one-copy target for worker or deferred consumption. */
export interface AsyncPlanTarget {
  readonly delivery: 'owned';
  readonly maximumPlanBytes: number;
  accept(candidate: AsyncPlanCandidate, signal: AbortSignal): Promise<AsyncPlanTargetResult>;
  dispose(): void;
}

/** Either supported plan-delivery contract. */
export type RenderPlanTarget = PlanTarget | AsyncPlanTarget;

/** One formatted-text span using handle-bound renderer and font values. */
export interface RetainedTextSpan {
  readonly start: number;
  readonly end: number;
  readonly font?: HandleFontStackBinding;
  readonly material?: HandleMaterialBinding;
  /** Text shaping and presentation overrides for this inline span. */
  readonly style?: TextStyle;
}

/** Styled text accepted by a retained text instance. */
export interface RetainedFormattedText {
  readonly text: string;
  readonly spans: readonly RetainedTextSpan[];
}

/** Plain or formatted input accepted by a retained text instance. */
export type RetainedTextInput = string | RetainedFormattedText;

/** A flow region whose transform is already bound to the handle. */
export type RetainedTextRegionInput = Omit<
  PlannerRegion,
  'id' | 'geometryRevision' | 'transformIndex' | 'exclusionStart' | 'exclusionCount'
> & {
  readonly transform: HandleTransformBinding;
};

/** An exclusion authored relative to its containing flow region. */
export type RetainedTextExclusionInput = Omit<PlannerExclusion, 'id' | 'regionId' | 'geometryRevision'>;

/** One flow region and its exclusions. */
export interface RetainedTextFlowRegionInput {
  readonly region: RetainedTextRegionInput;
  readonly exclusions?: readonly RetainedTextExclusionInput[];
}

/** Ordered regions through which one retained text instance flows. */
export interface RetainedTextFlowInput {
  readonly regions: readonly RetainedTextFlowRegionInput[];
}

/** Inline-object input using handle-bound material and resource values. */
export type RetainedTextInlineObjectInput = Omit<
  PlannerInlineObject,
  'paragraphId' | 'id' | 'contentRevision' | 'materialId' | 'resourceId' | 'resourceGeneration'
> & {
  readonly material: HandleMaterialBinding;
  readonly resource: HandleResourceBinding;
};

/** Fixed safety and capacity limits for one render planner. */
export interface RenderPlannerLimits extends PlannerFrameLimits {}

/** Initial desired state for one retained text instance. */
export interface RetainedTextOptions {
  readonly font: HandleFontStackBinding;
  readonly text: RetainedTextInput;
  readonly material?: HandleMaterialBinding;
  readonly transform?: HandleTransformBinding;
  readonly order?: number;
  readonly rasterPixelRatio?: number;
  /** Text shaping and presentation properties inherited by inline spans. */
  readonly style?: TextStyle;
  /** Paragraph flow properties such as wrapping, alignment, and line limits. */
  readonly layout?: ParagraphLayout;
  /** Bounds imposed on the measured and rendered paragraph. */
  readonly constraints?: Constraints;
  readonly flow?: RetainedTextFlowInput;
  readonly inlineObjects?: readonly RetainedTextInlineObjectInput[];
}

/** Partial desired-state replacement for one retained text instance. */
export type RetainedTextUpdate = Partial<Omit<RetainedTextOptions, 'font'>> & {
  readonly font?: HandleFontStackBinding;
};

/** One planner-owned retained text instance. */
export interface RetainedText {
  readonly disposed: boolean;
  update(update: RetainedTextUpdate): void;
  /** Returns aggregate metrics; a cache miss may synchronously incur font and measure lookup work. */
  measure(): ParagraphLayoutSummary;
  /** Returns caller-owned columns; a cache miss may synchronously incur glyph lookup and positioning work. */
  glyphs(): GlyphLayoutInspection;
  /** Offers a complete checkpoint containing selected committed stable glyph ids to one renderer target. */
  copyGlyphs(stableIds: ArrayLike<number>, target: PlanTarget): PlanAcceptance;
  /** Offers a complete checkpoint containing this paragraph's committed decorations. */
  copyDecorations(target: PlanTarget): PlanAcceptance;
  dispose(): void;
}

/** Optional semantic views to cache while compiling the next publication. */
export interface RenderPlannerPublishOptions {
  readonly semanticViews?: 'none' | 'measurement' | 'layout-inspection' | 'all';
  readonly compositing?: 'ordered' | 'independent';
}

interface RenderPlannerBase {
  readonly disposed: boolean;
  /** Creates one retained text instance in this planner. */
  createText(options: RetainedTextOptions): RetainedText;
  /** Disposes every retained text instance and releases this planner. */
  dispose(): void;
}

/** A synchronous producer of transient render plans for a synchronous target. */
export interface RenderPlanner extends RenderPlannerBase {
  /** Compiles and synchronously offers current desired state to the plan target. */
  publish(options?: RenderPlannerPublishOptions): PlanAcceptance;
}

/** An asynchronous producer of owned render plans for an asynchronous target. */
export interface AsyncRenderPlanner extends RenderPlannerBase {
  /** Copies, transfers, and asynchronously offers current desired state to the plan target. */
  publish(options?: RenderPlannerPublishOptions): Promise<PlanAcceptance>;
}

/** Resolves the planner surface from its target's delivery contract. */
export type RenderPlannerFor<Target extends RenderPlanTarget> = Target extends AsyncPlanTarget
  ? AsyncRenderPlanner
  : RenderPlanner;

/** Construction options for one retained-text planner and render target. */
export interface RenderPlannerOptions<Target extends RenderPlanTarget> {
  readonly codec: CodecRegistration;
  readonly capabilitySet?: PolicyCapabilitySet;
  readonly target: (control: PlanTargetControl) => Target;
  readonly limits: RenderPlannerLimits;
  readonly requestCapacity: number;
  readonly resultCapacity: number;
  readonly textCapacity: number;
}

/** @internal A planner that can query authored text but cannot publish a render plan. */
export interface MeasurementPlanner {
  readonly disposed: boolean;
  createText(options: RetainedTextOptions): RetainedText;
  dispose(): void;
}

/** @internal Renderer-free planner construction used by the root Paragraph service. */
export interface MeasurementPlannerOptions {
  readonly codec: CodecRegistration;
  readonly limits: RenderPlannerLimits;
  readonly requestCapacity: number;
  readonly resultCapacity: number;
  readonly textCapacity: number;
}

/** Thrown when a render planner is used after disposal. */
export class RenderPlannerDisposedError extends Error {
  constructor() {
    super('render planner has been disposed');
    this.name = 'RenderPlannerDisposedError';
  }
}

/** Thrown when a pending asynchronous acceptance prevents another plan call. */
export class RenderPlannerBackpressureError extends Error {}
/** Thrown when fixed transport capacity cannot encode the requested work. */
export class PlanTransportCapacityError extends Error {}
/** Thrown when an asynchronous target violates the transfer contract. */
export class PlanTransportError extends Error {}

interface ResolvedSpan {
  readonly start: number;
  readonly end: number;
  readonly font: ReturnType<GlyphHandleState['_retainFontStackBinding']> | undefined;
  readonly material: HandleBindingLease | undefined;
  readonly style: TextStyle | undefined;
}

interface ResolvedTextOptions {
  readonly source: RetainedTextOptions;
  readonly text: string;
  readonly spans: readonly ResolvedSpan[];
  readonly font: ReturnType<GlyphHandleState['_retainFontStackBinding']>;
  readonly material: HandleBindingLease | undefined;
  readonly transform: HandleBindingLease;
  readonly flowTransforms: readonly HandleBindingLease[];
  readonly inlineMaterials: readonly HandleBindingLease[];
  readonly inlineResources: readonly HandleBindingLease[];
}

interface RetainedTextState {
  readonly paragraphId: ParagraphId;
  readonly ordinal: number;
  desired: ResolvedTextOptions;
  metrics: RetainedTextMetrics;
  publishedText: string;
  publishedStyleCount: number;
  geometryRevision: number;
  published: boolean;
  dirty: boolean;
  removed: boolean;
  disposed: boolean;
  desiredReleased: boolean;
  committed: ResolvedTextOptions | undefined;
  measurement: ParagraphLayoutSummary | undefined;
  inspection: GlyphLayoutInspection | undefined;
}

interface RetainedTextMetrics {
  readonly order: number;
  readonly styleCount: number;
  readonly regionCount: number;
  readonly exclusionCount: number;
  readonly inlineObjectCount: number;
}

interface PendingPublication {
  readonly publication: PlanPublication;
  readonly checkpointGeneration: number;
}

const textStates = new WeakMap<object, Readonly<{ planner: RenderPlannerImpl; state: RetainedTextState }>>();

/** @internal Constructed only after GlyphHandleState validates handle ownership. */
export function createRenderPlanner<Target extends RenderPlanTarget>(
  handleState: GlyphHandleState,
  options: RenderPlannerOptions<Target>,
): RenderPlannerFor<Target> {
  return new RenderPlannerImpl(handleState, options) as RenderPlannerFor<Target>;
}

/** @internal Construct a query planner without a renderer acceptance target. */
export function createMeasurementPlanner(
  handleState: GlyphHandleState,
  options: MeasurementPlannerOptions,
): MeasurementPlanner {
  return new RenderPlannerImpl(handleState, options, true);
}

class RenderPlannerImpl {
  readonly #handleState: GlyphHandleState;
  readonly #transport: PlanTransport;
  readonly #codec: ReturnType<GlyphHandleState['_retainInstalledCodec']>;
  readonly #capabilitySet: ReturnType<typeof selectPolicyCapabilitySet> | undefined;
  readonly #target: RenderPlanTarget | undefined;
  readonly #control: TargetControlState | undefined;
  readonly #targetController = new AbortController();
  readonly #origin = Object.freeze({}) as PlanOrigin;
  readonly #limits: RenderPlannerLimits;
  readonly #texts = new Set<RetainedTextState>();
  readonly #removed = new Set<RetainedTextState>();
  readonly #measured = new Map<RetainedTextState, ResolvedTextOptions>();
  readonly #returnedBuffers: ExactFrameBufferPool | undefined;
  readonly #textsByOrder = new Map<number, RetainedTextState>();
  #liveTextCount = 0;
  #liveStyleCount = 0;
  #liveRegionCount = 0;
  #liveExclusionCount = 0;
  #liveInlineObjectCount = 0;
  #dirtyTextCount = 0;
  #pendingStyleCount = 0;
  #nextTextOrdinal = 1;
  #engineRevision = 0;
  #planRevision = 0;
  #acknowledgedGeneration = 0;
  #checkpointGeneration = 0;
  #acceptedCheckpointGeneration = 0;
  #structureRevision = 0;
  #measuredStructureRevision = -1;
  #textCapacity: number;
  #pending = false;
  #disposed = false;

  constructor(
    handleState: GlyphHandleState,
    options: RenderPlannerOptions<RenderPlanTarget> | MeasurementPlannerOptions,
    measurementOnly = false,
  ) {
    this.#handleState = handleState;
    if (measurementOnly) assertMeasurementPlanOptions(options);
    else assertRenderPlannerOptions(options);
    this.#limits = snapshotLimits(options.limits);
    this.#textCapacity = options.textCapacity;
    const codec = handleState._retainInstalledCodec(options.codec);
    if (measurementOnly) {
      try {
        const handle = handleState._allocatePlannerHandle();
        this.#transport = handleState._createPlanTransport({
          handle,
          requestCapacity: options.requestCapacity,
          resultCapacity: options.resultCapacity,
          textCapacity: options.textCapacity,
        });
        this.#codec = codec;
        this.#capabilitySet = undefined;
        this.#target = undefined;
        this.#control = undefined;
        this.#returnedBuffers = undefined;
        return;
      } catch (error) {
        codec.dispose();
        throw error;
      }
    }
    const renderOptions = options as RenderPlannerOptions<RenderPlanTarget>;
    let target: RenderPlanTarget | undefined;
    let claimed = false;
    const control = new TargetControlState(() => {
      this.#assertActive();
      this.#checkpointGeneration = checkedNextCheckpointGeneration(this.#checkpointGeneration);
    });
    try {
      const capabilitySet =
        renderOptions.capabilitySet === undefined
          ? undefined
          : selectPolicyCapabilitySet(codec.handle, codec.descriptor, renderOptions.capabilitySet);
      target = renderOptions.target(control);
      assertTarget(target, this.#limits.maxOutputBytes);
      if (claimedTargets.has(target)) throw new TypeError('plan target is already attached to another render planner');
      claimedTargets.add(target);
      claimed = true;
      const handle = handleState._allocatePlannerHandle();
      this.#transport = handleState._createPlanTransport({
        handle,
        requestCapacity: options.requestCapacity,
        resultCapacity: options.resultCapacity,
        textCapacity: options.textCapacity,
      });
      this.#target = target;
      this.#control = control;
      this.#codec = codec;
      this.#capabilitySet = capabilitySet;
      this.#returnedBuffers =
        target.delivery === 'owned'
          ? createExactFrameBufferPool({
              maximumBufferBytes: target.maximumPlanBytes,
              maximumPooledBuffers: 2,
              maximumPooledBytes: target.maximumPlanBytes,
            })
          : undefined;
    } catch (error) {
      control.dispose();
      codec.dispose();
      if (claimed) {
        try {
          target!.dispose();
        } catch (disposeError) {
          throw combinedFailure(error, disposeError, 'render-planner construction and target disposal both failed');
        }
      }
      throw error;
    }
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  createText(options: RetainedTextOptions): RetainedText {
    this.#assertMutable();
    const ordinal = this.#nextTextOrdinal;
    const nextOrdinal = checkedNextOrdinal(ordinal);
    const desired = resolveTextOptions(this.#handleState, options, ordinal);
    const state: RetainedTextState = {
      paragraphId: this.#handleState.id('paragraph', `${this.#handleState.integration}/text/${ordinal}`),
      ordinal,
      desired,
      metrics: retainedTextMetrics(desired, ordinal),
      publishedText: '',
      publishedStyleCount: 0,
      geometryRevision: 0,
      published: false,
      dirty: true,
      removed: false,
      disposed: false,
      desiredReleased: false,
      committed: undefined,
      measurement: undefined,
      inspection: undefined,
    };
    try {
      this.#validateState(state);
    } catch (error) {
      releaseResolvedText(desired);
      throw error;
    }
    const text = new RetainedTextImpl(this, state);
    textStates.set(text, { planner: this, state });
    this.#addLiveState(state);
    this.#texts.add(state);
    this.#structureRevision = checkedNextStructureRevision(this.#structureRevision);
    this.#nextTextOrdinal = nextOrdinal;
    return text;
  }

  publish(options?: RenderPlannerPublishOptions): PlanAcceptance | Promise<PlanAcceptance> {
    this.#assertMutable();
    if (this.#target === undefined) throw new Error('measurement-only planners cannot publish render plans');
    const normalized = normalizePublishOptions(options);
    return this.#target.delivery === 'borrowed' ? this.#publishBorrowed(normalized) : this.#publishOwned(normalized);
  }

  /** @internal */
  _updateText(state: RetainedTextState, update: RetainedTextUpdate): void {
    this.#assertMutable();
    if (state.disposed) throw new Error('text engine text has been disposed');
    if (!isNonArrayObject(update)) throw new TypeError('text engine text update must be an object');
    const source = Object.freeze({ ...state.desired.source, ...update }) as RetainedTextOptions;
    const desired = resolveTextOptions(this.#handleState, source, state.ordinal);
    const candidate = { ...state, desired, metrics: retainedTextMetrics(desired, state.ordinal), dirty: true };
    try {
      this.#validateState(candidate, state);
    } catch (error) {
      releaseResolvedText(desired);
      throw error;
    }
    const previousOrder = state.metrics.order;
    const nextOrder = candidate.metrics.order;
    this.#replaceLiveState(state, candidate.metrics);
    releaseResolvedText(state.desired);
    state.desired = desired;
    state.metrics = candidate.metrics;
    state.dirty = true;
    state.measurement = undefined;
    state.inspection = undefined;
    if (previousOrder !== nextOrder) {
      this.#structureRevision = checkedNextStructureRevision(this.#structureRevision);
    }
  }

  /** @internal */
  _layoutText(state: RetainedTextState): ParagraphLayoutSummary {
    this.#assertTextQueryable(state);
    const cached = state.measurement;
    if (cached !== undefined) return cached;
    return this.#queryText(state, false);
  }

  /** @internal */
  _inspectText(state: RetainedTextState): GlyphLayoutInspection {
    this.#assertTextQueryable(state);
    const cached = state.inspection;
    if (cached !== undefined) return copyGlyphLayoutInspection(cached);
    return copyGlyphLayoutInspection(this.#queryText(state, true));
  }

  /** @internal */
  _copyGlyphs(state: RetainedTextState, stableIds: ArrayLike<number>, target: PlanTarget): PlanAcceptance {
    this.#assertCopyable(state, target);
    const publication = this.#transport.copyGlyphs(
      state.paragraphId,
      stableIds,
      this.#codec.handle,
      this.#capabilitySetId(),
      this.#limits.maxOutputBytes,
    );
    return this.#offerCopy(publication, target);
  }

  /** @internal */
  _copyDecorations(state: RetainedTextState, target: PlanTarget): PlanAcceptance {
    this.#assertCopyable(state, target);
    const publication = this.#transport.copyDecorations(
      state.paragraphId,
      this.#codec.handle,
      this.#capabilitySetId(),
      this.#limits.maxOutputBytes,
    );
    return this.#offerCopy(publication, target);
  }

  /** @internal */
  _disposeText(state: RetainedTextState): void {
    if (state.disposed) return;
    this.#assertMutable();
    state.disposed = true;
    this.#removeLiveState(state);
    releaseResolvedText(state.desired);
    state.desiredReleased = true;
    this.#structureRevision = checkedNextStructureRevision(this.#structureRevision);
    if (state.committed === undefined && !this.#measured.has(state)) {
      this.#texts.delete(state);
      return;
    }
    state.removed = true;
    state.dirty = true;
    this.#removed.add(state);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#handleState._assertEngineMutationAllowed();
    this.#disposed = true;
    this.#targetController.abort(new RenderPlannerDisposedError());
    this.#control?.dispose();
    let failure: unknown;
    const attempt = (dispose: () => void): void => {
      try {
        dispose();
      } catch (error) {
        failure ??= error;
      }
    };
    if (this.#target !== undefined) attempt(() => this.#target!.dispose());
    attempt(() => this.#transport.dispose());
    attempt(() => this.#clearMeasuredBindings());
    for (const state of this.#texts) {
      state.disposed = true;
      if (!state.desiredReleased) attempt(() => releaseResolvedText(state.desired));
      state.desiredReleased = true;
      if (state.committed !== undefined) attempt(() => releaseResolvedText(state.committed!));
      state.committed = undefined;
    }
    this.#texts.clear();
    this.#removed.clear();
    this.#textsByOrder.clear();
    this.#liveTextCount = 0;
    this.#liveStyleCount = 0;
    this.#liveRegionCount = 0;
    this.#liveExclusionCount = 0;
    this.#liveInlineObjectCount = 0;
    this.#dirtyTextCount = 0;
    this.#pendingStyleCount = 0;
    attempt(() => this.#codec.dispose());
    this.#returnedBuffers?.clear();
    this.#handleState._detachPlanner(this);
    if (failure !== undefined) throw failure;
  }

  #publishBorrowed(options: NormalizedPublishOptions): PlanAcceptance {
    const pending = this.#publishEngine(options);
    const { publication } = pending;
    const lease = new BorrowedPlanLease(publication, this.#transport);
    const candidate = this.#candidate(lease);
    const leaveBorrow = this.#handleState._enterBorrowedPlan();
    let result: PlanAcceptance;
    try {
      const answer = (this.#target as PlanTarget).accept(candidate, this.#targetController.signal);
      if (isPromiseLike(answer)) throw new TypeError('a borrowed plan target must answer synchronously');
      result = assertAcceptance(answer);
    } finally {
      lease.expire();
      leaveBorrow();
    }
    if (result.accepted) this.#accept(pending);
    return result;
  }

  async #publishOwned(options: NormalizedPublishOptions): Promise<PlanAcceptance> {
    const pending = this.#publishEngine(options);
    const { publication } = pending;
    const publicationByteLength = publication.bytes.byteLength;
    const bytes = this.#copyPlan(publication.bytes);
    const plan = new RenderPlanView().bindBytes(bytes);
    const payloadLeases = this.#resolvePlanPayloads(plan);
    const candidate: AsyncPlanCandidate = Object.freeze({
      origin: this.#origin,
      plan: new OwnedPlanReader(plan),
      engineRevision: publication.engineRevision,
      planRevision: publication.planRevision,
      publicationGeneration: publication.publicationGeneration,
      checkpoint: publicationIsCheckpoint(publication),
      bytes,
      payloads: Object.freeze(
        payloadLeases.map(({ referenceId, lease }) => ({
          referenceId: referenceId as ResourceHandle,
          identity: lease.identity,
          techniqueId: lease.techniqueId,
          resourceName: lease.resourceName,
          payload: lease.payload,
          resources: lease.resources,
        })),
      ),
      transforms: Object.freeze(this.#resolvedTransforms()),
    });
    this.#pending = true;
    let allocationSettled = false;
    const reclaimAttachedSource = (): void => {
      if (allocationSettled || bytes.buffer.byteLength === 0) return;
      this.#returnPlanBuffer(bytes);
      allocationSettled = true;
    };
    let outcome!: PlanAcceptance;
    let primaryFailure: unknown;
    try {
      const result = await abortableTargetAcceptance(
        (this.#target as AsyncPlanTarget).accept(candidate, this.#targetController.signal),
        this.#targetController.signal,
      );
      const accepted = assertAsyncAcceptance(result, publication, publicationByteLength);
      if (accepted.returnedBytes !== undefined) {
        if (bytes.buffer.byteLength !== 0 && accepted.returnedBytes.buffer !== bytes.buffer) {
          throw new PlanTransportError('async target copied the plan instead of transferring it');
        }
        this.#returnPlanBuffer(accepted.returnedBytes);
        allocationSettled = true;
      }
      if (accepted.accepted) this.#accept(pending);
      outcome = accepted.accepted ? { accepted: true } : { accepted: false, error: accepted.error };
    } catch (error) {
      primaryFailure = error;
    }
    this.#pending = false;
    let cleanupFailure: unknown;
    try {
      reclaimAttachedSource();
    } catch (error) {
      cleanupFailure = error;
    }
    for (const { lease } of payloadLeases) {
      try {
        lease.dispose();
      } catch (error) {
        cleanupFailure ??= error;
      }
    }
    if (primaryFailure !== undefined) {
      if (cleanupFailure !== undefined) {
        throw new AggregateError([primaryFailure, cleanupFailure], 'plan acceptance and cleanup both failed', {
          cause: primaryFailure,
        });
      }
      throw primaryFailure;
    }
    if (cleanupFailure !== undefined) throw cleanupFailure;
    return outcome;
  }

  #publishEngine(options: NormalizedPublishOptions): PendingPublication {
    this.#ensureTextCapacity();
    const checkpointGeneration = this.#checkpointGeneration;
    const frame = this.#compileFrame(options, checkpointGeneration);
    const publication = this.#transport.update(frame);
    this.#engineRevision = publication.engineRevision;
    this.#cacheSemanticViews(publication, options.semanticViewMask);
    this.#commitDesiredState();
    return { publication, checkpointGeneration };
  }

  #cacheSemanticViews(publication: PlanPublication, semanticViewMask: number): void {
    const masks = textShaperAbi.engine.semanticViewMasks;
    if ((semanticViewMask & masks.layoutInspection) !== 0) {
      const layouts = readPlannerLayouts(publication);
      for (const state of this.#texts) {
        const layout = layouts.get(state.paragraphId);
        if (layout === undefined) continue;
        state.measurement = layout;
        state.inspection = layout;
      }
      return;
    }
    if ((semanticViewMask & masks.measurement) === 0) return;
    const measurements = readPlannerMeasurements(publication);
    for (const state of this.#texts) {
      const measurement = measurements.get(state.paragraphId);
      if (measurement !== undefined) state.measurement = measurement;
    }
  }

  #queryText(state: RetainedTextState, inspection: false): ParagraphLayoutSummary;
  #queryText(state: RetainedTextState, inspection: true): GlyphLayoutInspection;
  #queryText(state: RetainedTextState, inspection: boolean): ParagraphLayoutSummary | GlyphLayoutInspection {
    this.#assertTextQueryable(state);
    this.#ensureTextCapacity();
    const styles = compileStyles(this.#handleState, state);
    const styleMutations: PlannerStyleMutation[] = [...styles];
    for (let index = styles.length + 1; index <= state.publishedStyleCount; index += 1) {
      styleMutations.push({
        opcode: 'remove',
        paragraphId: state.paragraphId,
        styleId: engineStyleId(this.#handleState.id, state.paragraphId, index),
      });
    }
    const geometry = compileGeometry(this.#handleState, state, 0, 0);
    const textChanged = !state.published || state.publishedText !== state.desired.text;
    const request = compilePlannerFrameUpdate({
      plannerId: this.#transport.handle,
      policyHandle: this.#codec.handle,
      ...(this.#capabilitySet === undefined ? {} : { capabilitySet: this.#capabilitySet }),
      expectedEngineRevision: this.#engineRevision,
      consumedPlanRevision: this.#planRevision,
      acknowledgedPublicationGeneration: this.#acknowledgedGeneration,
      semanticViewMask: inspection
        ? textShaperAbi.engine.semanticViewMasks.layoutInspection
        : textShaperAbi.engine.semanticViewMasks.measurement,
      limits: this.#limits,
      paragraphMutations: this.#measurementParagraphMutations(),
      textMutations: textChanged
        ? [
            {
              paragraphId: state.paragraphId,
              start: 0,
              deleteCount: state.publishedText.length,
              insert: state.desired.text,
            },
          ]
        : [],
      styleMutations,
      constraints: [geometry.constraint],
      regions: geometry.regions,
      exclusions: geometry.exclusions,
      inlineObjects: compileInlineObjects(this.#handleState, state),
    });
    const publication = this.#transport.measureParagraph(request, state.paragraphId);
    if (inspection) {
      const layout = readPlannerLayouts(publication).get(state.paragraphId);
      if (layout === undefined) throw new Error('text engine returned no layout inspection for retained text');
      this.#adoptMeasuredBindings(state);
      state.measurement = layout;
      state.inspection = layout;
      return layout;
    }
    const measurement = readPlannerMeasurements(publication).get(state.paragraphId);
    if (measurement === undefined) throw new Error('text engine returned no measurement for retained text');
    this.#adoptMeasuredBindings(state);
    state.measurement = measurement;
    return measurement;
  }

  #compileFrame(options: NormalizedPublishOptions, checkpointGeneration: number): Uint8Array {
    const paragraphMutations = [
      ...[...this.#removed].map((state) => ({ opcode: 'remove' as const, paragraphId: state.paragraphId })),
      ...[...this.#texts]
        .filter((state) => !state.removed && state.dirty)
        .map((state) => ({
          opcode: 'upsert' as const,
          paragraphId: state.paragraphId,
          order: state.desired.source.order ?? state.ordinal - 1,
        })),
    ];
    const textMutations = [...this.#texts].flatMap((state) => {
      if (state.removed || !state.dirty) return [];
      const mutation = minimalTextMutation(state.publishedText, state.desired.text);
      return mutation === undefined ? [] : [{ paragraphId: state.paragraphId, ...mutation }];
    });
    const styleMutations: PlannerStyleMutation[] = [];
    const constraints: PlannerConstraint[] = [];
    const regions: PlannerRegion[] = [];
    const exclusions: PlannerExclusion[] = [];
    const inlineObjects: PlannerInlineObject[] = [];
    for (const state of this.#texts) {
      if (state.removed || !state.dirty) continue;
      const styles = compileStyles(this.#handleState, state);
      styleMutations.push(...styles);
      for (let index = styles.length + 1; index <= state.publishedStyleCount; index += 1) {
        styleMutations.push({
          opcode: 'remove',
          paragraphId: state.paragraphId,
          styleId: engineStyleId(this.#handleState.id, state.paragraphId, index),
        });
      }
      const geometry = compileGeometry(this.#handleState, state, regions.length, exclusions.length);
      constraints.push(geometry.constraint);
      regions.push(...geometry.regions);
      exclusions.push(...geometry.exclusions);
      inlineObjects.push(...compileInlineObjects(this.#handleState, state));
    }
    return compilePlannerFrameUpdate({
      plannerId: this.#transport.handle,
      policyHandle: this.#codec.handle,
      ...(this.#capabilitySet === undefined ? {} : { capabilitySet: this.#capabilitySet }),
      expectedEngineRevision: this.#engineRevision,
      consumedPlanRevision: checkpointGeneration === this.#acceptedCheckpointGeneration ? this.#planRevision : 0,
      acknowledgedPublicationGeneration: this.#acknowledgedGeneration,
      semanticViewMask: options.semanticViewMask,
      compositingIndependent: options.compositingIndependent,
      limits: this.#limits,
      paragraphMutations,
      textMutations,
      styleMutations,
      constraints,
      regions,
      exclusions,
      inlineObjects,
    });
  }

  #validateState(state: RetainedTextState, replacing?: RetainedTextState): void {
    const styles = compileStyles(this.#handleState, state);
    const geometry = compileGeometry(this.#handleState, state, 0, 0);
    const inlineObjects = compileInlineObjects(this.#handleState, state);
    validatePlannerFrameRecords(
      {
        paragraphMutations: [
          {
            opcode: 'upsert',
            paragraphId: state.paragraphId,
            order: state.desired.source.order ?? state.ordinal - 1,
          },
        ],
        textMutations: [{ paragraphId: state.paragraphId, start: 0, deleteCount: 0, insert: state.desired.text }],
        styleMutations: styles,
        constraints: [geometry.constraint],
        regions: geometry.regions,
        exclusions: geometry.exclusions,
        inlineObjects,
      },
      this.#limits,
    );
    this.#validateAggregateLimits(state, replacing);
  }

  #validateAggregateLimits(candidate: RetainedTextState, replacing?: RetainedTextState): void {
    const owner = this.#textsByOrder.get(candidate.metrics.order);
    if (owner !== undefined && owner !== replacing) {
      throw new RangeError(`retained text order ${candidate.metrics.order} is already in use`);
    }
    const previous = replacing?.metrics;
    const liveTextCount = this.#liveTextCount + (replacing === undefined ? 1 : 0);
    const liveStyleCount = this.#liveStyleCount - (previous?.styleCount ?? 0) + candidate.metrics.styleCount;
    const regionCount = this.#liveRegionCount - (previous?.regionCount ?? 0) + candidate.metrics.regionCount;
    const exclusionCount =
      this.#liveExclusionCount - (previous?.exclusionCount ?? 0) + candidate.metrics.exclusionCount;
    const inlineObjectCount =
      this.#liveInlineObjectCount - (previous?.inlineObjectCount ?? 0) + candidate.metrics.inlineObjectCount;
    const dirtyTextCount = this.#dirtyTextCount - Number(replacing?.dirty ?? false) + 1;
    const pendingStyleCount =
      this.#pendingStyleCount -
      (replacing?.dirty ? pendingStyleMutationCount(replacing) : 0) +
      pendingStyleMutationCount(candidate);
    if (liveTextCount > this.#limits.maxParagraphs) {
      throw new RangeError('retained texts exceed limits.maxParagraphs');
    }
    if (liveStyleCount > this.#limits.maxClusters) {
      throw new RangeError('retained text styles exceed limits.maxClusters');
    }
    if (liveTextCount > this.#limits.maxRegions || regionCount > this.#limits.maxRegions) {
      throw new RangeError('retained text regions exceed limits.maxRegions');
    }
    if (exclusionCount > this.#limits.maxExclusions) {
      throw new RangeError('retained text exclusions exceed limits.maxExclusions');
    }
    if (inlineObjectCount > this.#limits.maxInlineObjects) {
      throw new RangeError('retained inline objects exceed limits.maxInlineObjects');
    }
    if (this.#removed.size + dirtyTextCount > this.#limits.maxParagraphs) {
      throw new RangeError('pending paragraph mutations exceed limits.maxParagraphs');
    }
    if (dirtyTextCount > this.#limits.maxClusters) {
      throw new RangeError('pending text mutations exceed limits.maxClusters');
    }
    if (pendingStyleCount > this.#limits.maxClusters) {
      throw new RangeError('pending style mutations exceed limits.maxClusters');
    }
  }

  #addLiveState(state: RetainedTextState): void {
    this.#textsByOrder.set(state.metrics.order, state);
    this.#liveTextCount += 1;
    this.#liveStyleCount += state.metrics.styleCount;
    this.#liveRegionCount += state.metrics.regionCount;
    this.#liveExclusionCount += state.metrics.exclusionCount;
    this.#liveInlineObjectCount += state.metrics.inlineObjectCount;
    this.#dirtyTextCount += Number(state.dirty);
    if (state.dirty) this.#pendingStyleCount += pendingStyleMutationCount(state);
  }

  #replaceLiveState(state: RetainedTextState, metrics: RetainedTextMetrics): void {
    if (state.metrics.order !== metrics.order) {
      this.#textsByOrder.delete(state.metrics.order);
      this.#textsByOrder.set(metrics.order, state);
    }
    this.#liveStyleCount += metrics.styleCount - state.metrics.styleCount;
    this.#liveRegionCount += metrics.regionCount - state.metrics.regionCount;
    this.#liveExclusionCount += metrics.exclusionCount - state.metrics.exclusionCount;
    this.#liveInlineObjectCount += metrics.inlineObjectCount - state.metrics.inlineObjectCount;
    if (state.dirty) this.#pendingStyleCount -= pendingStyleMutationCount(state);
    const candidate = { ...state, metrics, dirty: true };
    this.#dirtyTextCount += Number(!state.dirty);
    this.#pendingStyleCount += pendingStyleMutationCount(candidate);
  }

  #removeLiveState(state: RetainedTextState): void {
    this.#textsByOrder.delete(state.metrics.order);
    this.#liveTextCount -= 1;
    this.#liveStyleCount -= state.metrics.styleCount;
    this.#liveRegionCount -= state.metrics.regionCount;
    this.#liveExclusionCount -= state.metrics.exclusionCount;
    this.#liveInlineObjectCount -= state.metrics.inlineObjectCount;
    this.#dirtyTextCount -= Number(state.dirty);
    if (state.dirty) this.#pendingStyleCount -= pendingStyleMutationCount(state);
  }

  #commitDesiredState(): void {
    this.#clearMeasuredBindings();
    for (const state of this.#removed) {
      this.#texts.delete(state);
      if (!state.desiredReleased) releaseResolvedText(state.desired);
      state.desiredReleased = true;
      if (state.committed !== undefined) releaseResolvedText(state.committed);
      state.committed = undefined;
    }
    this.#removed.clear();
    for (const state of this.#texts) {
      if (!state.dirty) continue;
      if (state.committed !== state.desired) {
        retainResolvedText(state.desired);
        if (state.committed !== undefined) releaseResolvedText(state.committed);
        state.committed = state.desired;
      }
      state.published = true;
      state.publishedText = state.desired.text;
      state.geometryRevision += 1;
      this.#dirtyTextCount -= 1;
      this.#pendingStyleCount -= pendingStyleMutationCount(state);
      state.publishedStyleCount = compiledStyleCount(state);
      state.dirty = false;
    }
  }

  #candidate(lease: BorrowedPlanLease): PlanCandidate {
    return Object.freeze({
      origin: this.#origin,
      plan: lease.reader,
      engineRevision: lease.publication.engineRevision,
      planRevision: lease.publication.planRevision,
      publicationGeneration: lease.publication.publicationGeneration,
      checkpoint: publicationIsCheckpoint(lease.publication),
      transforms: Object.freeze(this.#resolvedTransforms()),
      acquirePayload: (referenceId: ResourceHandle) => {
        lease.assertActive();
        return this.#portablePayload(referenceId);
      },
      resolveMaterial: (materialId: MaterialHandle) => {
        lease.assertActive();
        return this.#handleState._resolveOpaqueBinding('material', materialId) as HandleMaterialBinding;
      },
      resolveResource: (resourceId: ResourceHandle) => {
        lease.assertActive();
        return this.#handleState._resolveOpaqueBinding('resource', resourceId) as HandleResourceBinding;
      },
    });
  }

  #offerCopy(publication: PlanPublication, target: PlanTarget): PlanAcceptance {
    const lease = new BorrowedPlanLease(publication, this.#transport);
    const leaveBorrow = this.#handleState._enterBorrowedPlan();
    try {
      const answer = target.accept(this.#candidate(lease), this.#targetController.signal);
      if (isPromiseLike(answer)) throw new TypeError('a detached plan target must answer synchronously');
      return assertAcceptance(answer);
    } finally {
      lease.expire();
      leaveBorrow();
    }
  }

  #assertCopyable(state: RetainedTextState, target: PlanTarget): void {
    this.#assertTextQueryable(state);
    if (!state.published || state.committed === undefined) {
      throw new Error('retained text must have a committed render publication before it can be copied');
    }
    if (typeof target !== 'object' || target === null || target.delivery !== 'borrowed') {
      throw new TypeError('detached plan copies require a synchronous borrowed plan target');
    }
  }

  #capabilitySetId(): number {
    return this.#capabilitySet === undefined
      ? 1
      : policyCapabilitySetSelectionId(this.#capabilitySet, this.#codec.handle);
  }

  #portablePayload(referenceId: ResourceHandle): PortablePayloadLease {
    const lease = this.#handleState._acquirePortablePayload(referenceId);
    let disposed = false;
    return Object.freeze({
      referenceId,
      identity: lease.identity as PortablePayloadIdentity,
      techniqueId: lease.techniqueId,
      resourceName: lease.resourceName,
      payload: lease.payload,
      resources: Object.freeze(
        lease.resources.map((resource) =>
          Object.freeze({
            referenceId: resource.referenceId as ResourceHandle,
            identity: resource.identity as PortablePayloadIdentity,
            resourceName: resource.resourceName,
            payload: resource.payload,
          }),
        ),
      ),
      get disposed() {
        return disposed;
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        lease.dispose();
      },
    });
  }

  #resolvePlanPayloads(plan: RenderPlanView): readonly Readonly<{
    referenceId: number;
    lease: PortablePayloadLease;
  }>[] {
    const table = plan.table('resources');
    const leases: Array<Readonly<{ referenceId: number; lease: PortablePayloadLease }>> = [];
    const seen = new Set<number>();
    try {
      for (let index = 0; index < table.count; index += 1) {
        const referenceId = readTrustedRenderPlanResourceReferenceId(plan, table, index);
        if (referenceId === 0 || seen.has(referenceId)) continue;
        seen.add(referenceId);
        leases.push({ referenceId, lease: this.#portablePayload(referenceId as ResourceHandle) });
      }
      return leases;
    } catch (error) {
      for (const { lease } of leases) lease.dispose();
      throw error;
    }
  }

  #resolvedTransforms(): readonly ResolvedPlanTransform[] {
    const transforms = new Map<number, ResolvedPlanTransform>();
    for (const state of this.#texts) {
      if (state.removed) continue;
      const rootIndex = state.desired.transform.handle as RenderPlanTransformId;
      transforms.set(rootIndex, {
        transformIndex: rootIndex,
        instanceId: state.paragraphId as unknown as RenderPlanTransformId,
        binding: this.#handleState._resolveOpaqueBinding(
          'transform',
          state.desired.transform.handle,
        ) as HandleTransformBinding,
      });
      for (const transform of state.desired.flowTransforms) {
        const transformIndex = transform.handle as RenderPlanTransformId;
        transforms.set(transformIndex, {
          transformIndex,
          binding: this.#handleState._resolveOpaqueBinding('transform', transform.handle) as HandleTransformBinding,
        });
      }
    }
    return [...transforms.values()];
  }

  #measurementParagraphMutations(): PlannerParagraphMutation[] {
    return [
      ...[...this.#removed]
        .filter((state) => state.published)
        .map((state) => ({ opcode: 'remove' as const, paragraphId: state.paragraphId })),
      ...[...this.#texts]
        .filter((state) => !state.removed)
        .map((state) => ({
          opcode: 'upsert' as const,
          paragraphId: state.paragraphId,
          order: state.desired.source.order ?? state.ordinal - 1,
        })),
    ];
  }

  #adoptMeasuredBindings(state: RetainedTextState): void {
    if (this.#measuredStructureRevision !== this.#structureRevision) this.#clearMeasuredBindings();
    const previous = this.#measured.get(state);
    if (previous !== state.desired) {
      retainResolvedText(state.desired);
      this.#measured.set(state, state.desired);
      if (previous !== undefined) releaseResolvedText(previous);
    }
    this.#measuredStructureRevision = this.#structureRevision;
    for (const removed of [...this.#removed]) {
      if (removed.committed !== undefined || this.#measured.has(removed)) continue;
      this.#removed.delete(removed);
      this.#texts.delete(removed);
    }
  }

  #clearMeasuredBindings(): void {
    let failure: unknown;
    for (const bindings of this.#measured.values()) {
      try {
        releaseResolvedText(bindings);
      } catch (error) {
        failure ??= error;
      }
    }
    this.#measured.clear();
    this.#measuredStructureRevision = -1;
    if (failure !== undefined) throw failure;
  }

  #copyPlan(source: Uint8Array): Uint8Array<ArrayBuffer> {
    if (source.byteLength > (this.#target as AsyncPlanTarget).maximumPlanBytes) {
      throw new PlanTransportCapacityError('render plan exceeds the target transfer limit');
    }
    const buffer = this.#returnedBuffers!.acquire(source.byteLength);
    const bytes = new Uint8Array(buffer);
    bytes.set(source);
    return bytes;
  }

  #returnPlanBuffer(bytes: Uint8Array<ArrayBuffer>): void {
    if (!(bytes instanceof Uint8Array) || bytes.byteOffset !== 0 || bytes.byteLength !== bytes.buffer.byteLength) {
      throw new PlanTransportError('async target returned a non-full-span plan buffer');
    }
    this.#returnedBuffers!.release(bytes.buffer);
  }

  #accept({ publication, checkpointGeneration }: PendingPublication): void {
    this.#planRevision = publication.planRevision;
    this.#acknowledgedGeneration = publication.publicationGeneration;
    this.#acceptedCheckpointGeneration = checkpointGeneration;
  }

  #assertMutable(): void {
    this.#assertActive();
    if (this.#pending) throw new RenderPlannerBackpressureError('an asynchronous plan acceptance is already pending');
  }

  #assertTextQueryable(state: RetainedTextState): void {
    this.#assertMutable();
    if (state.disposed) throw new Error('text engine text has been disposed');
  }

  #ensureTextCapacity(): void {
    let required = 1;
    for (const state of this.#texts) {
      if (!state.removed) required = Math.max(required, state.desired.text.length);
    }
    if (required <= this.#textCapacity) return;
    this.#transport._reserveText(required);
    this.#textCapacity = required;
  }

  #assertActive(): void {
    if (this.#disposed) throw new RenderPlannerDisposedError();
  }
}

class RetainedTextImpl implements RetainedText {
  readonly #planner: RenderPlannerImpl;
  readonly #state: RetainedTextState;

  constructor(planner: RenderPlannerImpl, state: RetainedTextState) {
    this.#planner = planner;
    this.#state = state;
  }

  get disposed(): boolean {
    return this.#state.disposed;
  }

  update(update: RetainedTextUpdate): void {
    this.#planner._updateText(this.#state, update);
  }

  measure(): ParagraphLayoutSummary {
    return this.#planner._layoutText(this.#state);
  }

  glyphs(): GlyphLayoutInspection {
    return this.#planner._inspectText(this.#state);
  }

  copyGlyphs(stableIds: ArrayLike<number>, target: PlanTarget): PlanAcceptance {
    return this.#planner._copyGlyphs(this.#state, stableIds, target);
  }

  copyDecorations(target: PlanTarget): PlanAcceptance {
    return this.#planner._copyDecorations(this.#state, target);
  }

  dispose(): void {
    this.#planner._disposeText(this.#state);
  }
}

class BorrowedPlanLease {
  readonly publication: PlanPublication;
  readonly reader: BorrowedRenderPlan;
  #active = true;

  constructor(publication: PlanPublication, transport: PlanTransport) {
    this.publication = publication;
    const view = new RenderPlanView().bind(publication);
    this.reader = new GuardedPlanReader('borrowed', view, () => this.assertActive());
    this.#transport = transport;
  }

  readonly #transport: PlanTransport;

  assertActive(): void {
    if (!this.#active || this.#transport.isExpired(this.publication)) {
      throw new Error('borrowed text render plan has expired');
    }
  }

  expire(): void {
    this.#active = false;
  }
}

class GuardedPlanReader implements BorrowedRenderPlan {
  readonly delivery = 'borrowed' as const;
  readonly #view: RenderPlanView;
  readonly #assertActive: () => void;

  constructor(_delivery: 'borrowed', view: RenderPlanView, assertActive: () => void) {
    this.#view = view;
    this.#assertActive = assertActive;
  }

  table(name: RenderPlanTableName): RenderPlanTable {
    this.#assertActive();
    return this.#view.table(name);
  }
  record(table: RenderPlanTable, index: number): number {
    this.#assertActive();
    return this.#view.record(table, index);
  }
  u8(offset: number): number {
    this.#assertActive();
    return this.#view.u8(offset);
  }
  u16(offset: number): number {
    this.#assertActive();
    return this.#view.u16(offset);
  }
  u32(offset: number): number {
    this.#assertActive();
    return this.#view.u32(offset);
  }
  f32(offset: number): number {
    this.#assertActive();
    return this.#view.f32(offset);
  }
  bytes(offset: number, byteLength: number): Uint8Array {
    this.#assertActive();
    return this.#view.bytes(offset, byteLength);
  }
}

class OwnedPlanReader implements OwnedRenderPlan {
  readonly delivery = 'owned' as const;
  readonly #view: RenderPlanView;
  constructor(view: RenderPlanView) {
    this.#view = view;
  }
  table(name: RenderPlanTableName): RenderPlanTable {
    return this.#view.table(name);
  }
  record(table: RenderPlanTable, index: number): number {
    return this.#view.record(table, index);
  }
  u8(offset: number): number {
    return this.#view.u8(offset);
  }
  u16(offset: number): number {
    return this.#view.u16(offset);
  }
  u32(offset: number): number {
    return this.#view.u32(offset);
  }
  f32(offset: number): number {
    return this.#view.f32(offset);
  }
  bytes(offset: number, byteLength: number): Uint8Array {
    return this.#view.bytes(offset, byteLength);
  }
}

interface NormalizedPublishOptions {
  readonly semanticViewMask: number;
  readonly compositingIndependent: boolean;
}

function normalizePublishOptions(value: RenderPlannerPublishOptions | undefined): NormalizedPublishOptions {
  if (value !== undefined && !isNonArrayObject(value)) throw new TypeError('publish options must be an object');
  const semanticViews = value?.semanticViews ?? 'none';
  const masks = textShaperAbi.engine.semanticViewMasks;
  const semanticViewMask =
    semanticViews === 'none'
      ? 0
      : semanticViews === 'measurement'
        ? masks.measurement
        : semanticViews === 'layout-inspection'
          ? masks.layoutInspection
          : semanticViews === 'all'
            ? masks.measurement | masks.layoutInspection
            : -1;
  if (semanticViewMask < 0) throw new TypeError('semanticViews is not supported');
  const compositing = value?.compositing ?? 'ordered';
  if (compositing !== 'ordered' && compositing !== 'independent') {
    throw new TypeError('compositing must be "ordered" or "independent"');
  }
  return {
    semanticViewMask,
    compositingIndependent: compositing === 'independent',
  };
}

function resolveTextOptions(
  handleState: GlyphHandleState,
  value: RetainedTextOptions,
  ordinal: number,
): ResolvedTextOptions {
  if (!isNonArrayObject(value)) throw new TypeError('text engine text options must be an object');
  validateTextScalarOptions(value, ordinal);
  const formattedText = normalizeTextInput(value.text);
  const style = value.style ?? {};
  const layout = value.layout ?? {};
  const constraints = value.constraints ?? {};
  assertTextStyle(style, 'text style');
  assertTextStyleFeatureRanges(style, 0, formattedText.text.length, 'text style');
  assertParagraphLayout(layout, 'text layout');
  assertConstraints(constraints, 'text constraints');
  normalizedColumns(layout, constraints);
  const font = handleState._retainFontStackBinding(value.font);
  const leases: Array<{ dispose(): void }> = [font];
  try {
    assertTextEffectsSupported(style, font.techniques, 'text engine text style');
    const material =
      value.material === undefined ? undefined : handleState._retainOpaqueBinding(value.material, 'material');
    if (material !== undefined) leases.push(material);
    const createdTransform = value.transform === undefined;
    const transformBinding = value.transform ?? handleState.createTransformBinding();
    const transform = handleState._retainOpaqueBinding(transformBinding, 'transform');
    leases.push(transform);
    if (createdTransform) transformBinding.dispose();
    const spans = formattedText.spans.map((span) => {
      if (span.style !== undefined) {
        assertTextStyle(span.style, `text span style [${span.start}, ${span.end})`);
        assertTextStyleFeatureRanges(span.style, span.start, span.end, `text span style [${span.start}, ${span.end})`);
      }
      const spanFont = span.font === undefined ? undefined : handleState._retainFontStackBinding(span.font);
      if (spanFont !== undefined) leases.push(spanFont);
      if (span.style !== undefined) {
        assertTextEffectsSupported(
          span.style,
          spanFont?.techniques ?? font.techniques,
          `text engine span [${span.start}, ${span.end}) style`,
        );
      }
      const spanMaterial =
        span.material === undefined ? undefined : handleState._retainOpaqueBinding(span.material, 'material');
      if (spanMaterial !== undefined) leases.push(spanMaterial);
      return Object.freeze({
        start: span.start,
        end: span.end,
        font: spanFont,
        material: spanMaterial,
        style: span.style,
      });
    });
    const flowTransforms: HandleBindingLease[] = [];
    for (const flowRegion of value.flow?.regions ?? []) {
      const retained = handleState._retainOpaqueBinding(flowRegion.region.transform, 'transform');
      leases.push(retained);
      flowTransforms.push(retained);
    }
    const inlineMaterials: HandleBindingLease[] = [];
    const inlineResources: HandleBindingLease[] = [];
    for (const object of value.inlineObjects ?? []) {
      const retainedMaterial = handleState._retainOpaqueBinding(object.material, 'material');
      leases.push(retainedMaterial);
      inlineMaterials.push(retainedMaterial);
      const retainedResource = handleState._retainOpaqueBinding(object.resource, 'resource');
      leases.push(retainedResource);
      inlineResources.push(retainedResource);
    }
    return ownResolvedText({
      source: snapshotTextOptions(
        value,
        formattedText,
        font,
        material,
        transform,
        spans,
        flowTransforms,
        inlineMaterials,
        inlineResources,
      ),
      text: formattedText.text,
      spans: Object.freeze(spans),
      font,
      material,
      transform,
      flowTransforms: Object.freeze(flowTransforms),
      inlineMaterials: Object.freeze(inlineMaterials),
      inlineResources: Object.freeze(inlineResources),
    });
  } catch (error) {
    for (const lease of leases.reverse()) lease.dispose();
    throw error;
  }
}

function normalizeTextInput(value: unknown): RetainedFormattedText {
  if (typeof value === 'string') return Object.freeze({ text: value, spans: Object.freeze([]) });
  if (!isNonArrayObject(value) || typeof value.text !== 'string' || !Array.isArray(value.spans)) {
    throw new TypeError('text must be a string or formatted text value');
  }
  const text = value.text;
  const spans = value.spans.map((span, index) => {
    if (!isNonArrayObject(span)) throw new TypeError(`text span ${index} must be an object`);
    if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end)) {
      throw new TypeError(`text span ${index} bounds must be safe integers`);
    }
    if (
      (span.start as number) < 0 ||
      (span.end as number) < (span.start as number) ||
      (span.end as number) > text.length
    ) {
      throw new RangeError(`text span ${index} is outside the text`);
    }
    return Object.freeze({
      start: span.start as number,
      end: span.end as number,
      ...(span.font === undefined ? {} : { font: span.font as HandleFontStackBinding }),
      ...(span.material === undefined ? {} : { material: span.material as HandleMaterialBinding }),
      ...(span.style === undefined
        ? {}
        : { style: cloneAuthoredData(span.style as TextStyle, `text span ${index} style`) }),
    });
  });
  return Object.freeze({ text, spans: Object.freeze(alignSpansToClusters(text, spans)) });
}

function snapshotTextOptions(
  value: RetainedTextOptions,
  input: RetainedFormattedText,
  font: ReturnType<GlyphHandleState['_retainFontStackBinding']>,
  material: HandleBindingLease | undefined,
  transform: HandleBindingLease,
  spans: readonly ResolvedSpan[],
  flowTransforms: readonly HandleBindingLease[],
  inlineMaterials: readonly HandleBindingLease[],
  inlineResources: readonly HandleBindingLease[],
): RetainedTextOptions {
  const {
    font: _font,
    text: _text,
    material: _material,
    transform: _transform,
    flow: _flow,
    inlineObjects: _inlineObjects,
    ...rest
  } = value;
  const snapshot = cloneAuthoredData(rest, 'text options');
  const text = Object.freeze({
    text: input.text,
    spans: Object.freeze(
      spans.map((span) =>
        Object.freeze({
          start: span.start,
          end: span.end,
          ...(span.font === undefined ? {} : { font: span.font.binding }),
          ...(span.material === undefined ? {} : { material: span.material.binding as HandleMaterialBinding }),
          ...(span.style === undefined ? {} : { style: span.style }),
        }),
      ),
    ),
  });
  return Object.freeze({
    ...snapshot,
    font: font.binding,
    text,
    ...(material === undefined ? {} : { material: material.binding as HandleMaterialBinding }),
    transform: transform.binding as HandleTransformBinding,
    ...(value.flow === undefined
      ? {}
      : {
          flow: Object.freeze({
            regions: Object.freeze(
              value.flow.regions.map((flowRegion, index) => {
                const { transform: _regionTransform, ...region } = flowRegion.region;
                return Object.freeze({
                  region: Object.freeze({
                    ...cloneAuthoredData(region, `text flow region ${index}`),
                    transform: flowTransforms[index]!.binding as HandleTransformBinding,
                  }),
                  ...(flowRegion.exclusions === undefined
                    ? {}
                    : {
                        exclusions: Object.freeze(
                          cloneAuthoredData(flowRegion.exclusions, `text flow region ${index} exclusions`),
                        ),
                      }),
                });
              }),
            ),
          }),
        }),
    ...(value.inlineObjects === undefined
      ? {}
      : {
          inlineObjects: Object.freeze(
            value.inlineObjects.map((object, index) => {
              const { material: _inlineMaterial, resource: _inlineResource, ...data } = object;
              return Object.freeze({
                ...cloneAuthoredData(data, `text inline object ${index}`),
                material: inlineMaterials[index]!.binding as HandleMaterialBinding,
                resource: inlineResources[index]!.binding as HandleResourceBinding,
              });
            }),
          ),
        }),
  });
}

function validateTextScalarOptions(value: RetainedTextOptions, ordinal: number): void {
  if (value.order !== undefined) uint32(value.order, 'text order');
  if (
    value.rasterPixelRatio !== undefined &&
    (!Number.isFinite(value.rasterPixelRatio) || value.rasterPixelRatio <= 0)
  ) {
    throw new RangeError('text rasterPixelRatio must be positive and finite');
  }
  if (
    value.flow !== undefined &&
    (!isNonArrayObject(value.flow) || !Array.isArray(value.flow.regions) || value.flow.regions.length === 0)
  ) {
    throw new TypeError('text flow must contain at least one region');
  }
  for (const [index, input] of (value.flow?.regions ?? []).entries()) {
    if (!isNonArrayObject(input) || !isNonArrayObject(input.region)) {
      throw new TypeError(`text flow region ${index} must contain a region object`);
    }
    if (input.exclusions !== undefined && !Array.isArray(input.exclusions)) {
      throw new TypeError(`text flow region ${index} exclusions must be an array`);
    }
  }
  if (value.inlineObjects !== undefined && !Array.isArray(value.inlineObjects)) {
    throw new TypeError('text inlineObjects must be an array');
  }
  for (const [index, object] of (value.inlineObjects ?? []).entries()) {
    if (!isNonArrayObject(object)) throw new TypeError(`text inline object ${index} must be an object`);
  }
  uint32(ordinal, 'text ordinal');
}

function compileStyles(handleState: GlyphHandleState, state: RetainedTextState): readonly PlannerStyleMutation[] {
  const desired = state.desired;
  const source = desired.source;
  const root: PlannerStyleMutation = {
    opcode: 'upsert',
    paragraphId: state.paragraphId,
    styleId: engineStyleId(handleState.id, state.paragraphId, 1),
    cascadeOrder: 0,
    start: 0,
    end: desired.text.length,
    root: true,
    value: engineStyleValue(source.style ?? {}, 0, desired.text.length, {
      fontStackHandle: desired.font.handle as never,
      fontSize: source.style?.fontSize ?? 16,
      rasterPixelRatio: source.rasterPixelRatio ?? 1,
      ...(desired.material === undefined ? {} : { materialId: desired.material.handle as MaterialHandle }),
    }),
  };
  return [
    root,
    ...desired.spans
      .filter((span) => span.start !== span.end)
      .map((span, index) => ({
        opcode: 'upsert' as const,
        paragraphId: state.paragraphId,
        styleId: engineStyleId(handleState.id, state.paragraphId, index + 2),
        cascadeOrder: index + 1,
        start: span.start,
        end: span.end,
        value: engineStyleValue(span.style ?? {}, span.start, span.end, {
          ...(span.font === undefined ? {} : { fontStackHandle: span.font.handle as never }),
          ...(span.material === undefined ? {} : { materialId: span.material.handle as MaterialHandle }),
        }),
      })),
  ];
}

function compiledStyleCount(state: RetainedTextState): number {
  return state.metrics.styleCount;
}

function retainedTextMetrics(desired: ResolvedTextOptions, ordinal: number): RetainedTextMetrics {
  let styleCount = 1;
  for (const span of desired.spans) styleCount += Number(span.start !== span.end);
  const flow = desired.source.flow;
  return {
    order: desired.source.order ?? ordinal - 1,
    styleCount,
    regionCount: flow?.regions.length ?? desired.source.layout?.columns?.count ?? 1,
    exclusionCount: flow?.regions.reduce((sum, region) => sum + (region.exclusions?.length ?? 0), 0) ?? 0,
    inlineObjectCount: desired.source.inlineObjects?.length ?? 0,
  };
}

function pendingStyleMutationCount(state: RetainedTextState): number {
  return state.metrics.styleCount + Math.max(0, state.publishedStyleCount - state.metrics.styleCount);
}

function compileGeometry(
  handleState: GlyphHandleState,
  state: RetainedTextState,
  regionStart: number,
  exclusionStart: number,
): Readonly<{
  constraint: PlannerConstraint;
  regions: readonly PlannerRegion[];
  exclusions: readonly PlannerExclusion[];
}> {
  const revision = state.geometryRevision + 1;
  const ordinary = compileEngineGeometry(
    handleState.id,
    state.paragraphId,
    state.desired.transform.handle,
    revision,
    state.desired.source.layout,
    state.desired.source.constraints,
    regionStart,
    state.desired.text.length,
  );
  const flow = state.desired.source.flow;
  if (flow === undefined) return { ...ordinary, exclusions: [] };
  const regions: PlannerRegion[] = [];
  const exclusions: PlannerExclusion[] = [];
  for (const [regionIndex, input] of flow.regions.entries()) {
    const transform = state.desired.flowTransforms[regionIndex]!;
    const firstExclusion = exclusionStart + exclusions.length;
    const regionId = handleState.id('region', `paragraph/${state.paragraphId}/flow/${regionIndex}`);
    regions.push({
      ...input.region,
      id: regionId,
      geometryRevision: revision,
      transformIndex: transform.handle,
      exclusionStart: firstExclusion,
      exclusionCount: input.exclusions?.length ?? 0,
    });
    for (const [index, exclusion] of (input.exclusions ?? []).entries()) {
      exclusions.push({
        ...exclusion,
        id: handleState.id('exclusion', `paragraph/${state.paragraphId}/flow/${regionIndex}/exclusion/${index}`),
        regionId,
        geometryRevision: revision,
      });
    }
  }
  return {
    constraint: { ...ordinary.constraint, regionStart, regionCount: regions.length },
    regions,
    exclusions,
  };
}

function compileInlineObjects(handleState: GlyphHandleState, state: RetainedTextState): readonly PlannerInlineObject[] {
  return (state.desired.source.inlineObjects ?? []).map((object, index) => ({
    ...object,
    paragraphId: state.paragraphId,
    id: handleState.id('inline-object', `paragraph/${state.paragraphId}/inline/${index}`),
    contentRevision: state.geometryRevision + 1,
    materialId: state.desired.inlineMaterials[index]!.handle as MaterialHandle,
    resourceId: state.desired.inlineResources[index]!.handle as ResourceHandle,
    resourceGeneration: 1,
  }));
}

const resolvedTextReferences = new WeakMap<ResolvedTextOptions, { references: number }>();

function ownResolvedText(value: ResolvedTextOptions): ResolvedTextOptions {
  if (resolvedTextReferences.has(value)) throw new Error('resolved text options are already owned');
  resolvedTextReferences.set(value, { references: 1 });
  return value;
}

function retainResolvedText(value: ResolvedTextOptions): void {
  const retained = resolvedTextReferences.get(value);
  if (retained === undefined || retained.references <= 0) {
    throw new Error('resolved text options are no longer retained');
  }
  retained.references += 1;
}

function releaseResolvedText(value: ResolvedTextOptions): void {
  const retained = resolvedTextReferences.get(value);
  if (retained === undefined || retained.references <= 0) {
    throw new Error('resolved text options are no longer retained');
  }
  retained.references -= 1;
  if (retained.references !== 0) return;
  resolvedTextReferences.delete(value);
  const leases: Array<{ dispose(): void }> = [
    value.font,
    ...(value.material === undefined ? [] : [value.material]),
    value.transform,
    ...value.flowTransforms,
    ...value.inlineMaterials,
    ...value.inlineResources,
    ...value.spans.flatMap((span) => [
      ...(span.font === undefined ? [] : [span.font]),
      ...(span.material === undefined ? [] : [span.material]),
    ]),
  ];
  let failure: unknown;
  for (const lease of leases.reverse()) {
    try {
      lease.dispose();
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== undefined) throw failure;
}

function assertRenderPlannerOptions(value: unknown): asserts value is RenderPlannerOptions<RenderPlanTarget> {
  if (!isNonArrayObject(value)) throw new TypeError('render planner options must be an object');
  if (typeof value.target !== 'function') throw new TypeError('render planner target must be a factory');
  assertRenderPlannerCapacities(value);
}

function assertMeasurementPlanOptions(value: unknown): asserts value is MeasurementPlannerOptions {
  if (!isNonArrayObject(value)) throw new TypeError('measurement plan options must be an object');
  assertRenderPlannerCapacities(value);
}

function assertRenderPlannerCapacities(value: Record<PropertyKey, unknown>): void {
  positiveU32(value.requestCapacity, 'requestCapacity');
  positiveU32(value.resultCapacity, 'resultCapacity');
  positiveU32(value.textCapacity, 'textCapacity');
  snapshotLimits(value.limits);
}

function snapshotLimits(value: unknown): RenderPlannerLimits {
  if (!isNonArrayObject(value)) throw new TypeError('text engine limits must be an object');
  const snapshot = Object.freeze({
    maxParagraphs: value.maxParagraphs,
    maxClusters: value.maxClusters,
    maxLines: value.maxLines,
    maxRegions: value.maxRegions,
    maxExclusions: value.maxExclusions,
    maxInlineObjects: value.maxInlineObjects,
    maxSlotsPerBand: value.maxSlotsPerBand,
    maxOutputBytes: value.maxOutputBytes,
  }) as RenderPlannerLimits;
  for (const [name, limit] of Object.entries(snapshot)) positiveU32(limit, name);
  if (snapshot.maxOutputBytes < textShaperAbi.layouts.engineResult.size) {
    throw new RangeError('maxOutputBytes cannot hold a text engine result header');
  }
  if (snapshot.maxOutputBytes > MAX_TEXT_ENGINE_OUTPUT_BYTES) {
    throw new RangeError('maxOutputBytes exceeds the text engine limit');
  }
  return snapshot;
}

function assertTarget(value: unknown, minimumPlanBytes: number): asserts value is RenderPlanTarget {
  if (!isNonArrayObject(value)) throw new TypeError('plan target factory must return an object');
  if (value.delivery !== 'borrowed' && value.delivery !== 'owned')
    throw new TypeError('plan target delivery is invalid');
  if (typeof value.accept !== 'function' || typeof value.dispose !== 'function') {
    throw new TypeError('plan target must implement accept() and dispose()');
  }
  if (value.delivery === 'owned') {
    positiveU32(value.maximumPlanBytes, 'maximumPlanBytes');
    if ((value.maximumPlanBytes as number) < minimumPlanBytes) {
      throw new RangeError('maximumPlanBytes must cover limits.maxOutputBytes');
    }
  }
}

class TargetControlState implements PlanTargetControl {
  readonly #request: () => void;
  #active = true;

  constructor(request: () => void) {
    this.#request = request;
  }

  requestCheckpoint(): void {
    if (!this.#active) throw new RenderPlannerDisposedError();
    this.#request();
  }

  dispose(): void {
    this.#active = false;
  }
}

function assertAcceptance(value: unknown): PlanAcceptance {
  if (!isNonArrayObject(value) || typeof value.accepted !== 'boolean') {
    throw new TypeError('plan target returned an invalid acceptance');
  }
  if (value.accepted) return Object.freeze({ accepted: true });
  if (!('error' in value)) throw new TypeError('rejected plan acceptance must carry an error');
  return Object.freeze({ accepted: false, error: value.error });
}

function assertAsyncAcceptance(
  value: unknown,
  publication: PlanPublication,
  publicationByteLength: number,
): Readonly<{ accepted: boolean; error?: unknown; returnedBytes?: Uint8Array<ArrayBuffer> }> {
  const accepted = assertAcceptance(value);
  const returnedBytes = isNonArrayObject(value) ? value.returnedBytes : undefined;
  if (returnedBytes !== undefined) {
    if (
      !(returnedBytes instanceof Uint8Array) ||
      !(returnedBytes.buffer instanceof ArrayBuffer) ||
      returnedBytes.byteOffset !== 0 ||
      returnedBytes.byteLength !== publicationByteLength ||
      returnedBytes.buffer.byteLength !== publicationByteLength
    ) {
      throw new PlanTransportError('async target returned the wrong plan buffer');
    }
    let returnedPlan: RenderPlanView;
    try {
      returnedPlan = new RenderPlanView().bindBytes(returnedBytes as Uint8Array<ArrayBuffer>);
    } catch (cause) {
      throw new PlanTransportError('async target returned malformed plan bytes', { cause });
    }
    const layout = textShaperAbi.layouts.engineResult;
    if (
      returnedPlan.u32(layout.engineRevision) !== publication.engineRevision ||
      returnedPlan.u32(layout.planRevision) !== publication.planRevision ||
      returnedPlan.u32(layout.publicationGeneration) !== publication.publicationGeneration
    ) {
      throw new PlanTransportError('async target returned bytes for a different publication');
    }
  }
  if (accepted.accepted && returnedBytes === undefined) {
    throw new PlanTransportError('accepted async plan did not return its transfer buffer');
  }
  return accepted.accepted
    ? { accepted: true, returnedBytes: returnedBytes as Uint8Array<ArrayBuffer> }
    : {
        accepted: false,
        error: accepted.error,
        ...(returnedBytes === undefined ? {} : { returnedBytes: returnedBytes as Uint8Array<ArrayBuffer> }),
      };
}

async function abortableTargetAcceptance(
  promise: Promise<AsyncPlanTargetResult>,
  signal: AbortSignal,
): Promise<AsyncPlanTargetResult> {
  if (!(promise instanceof Promise)) throw new TypeError('owned plan target accept() must return a Promise');
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(signal.reason ?? new RenderPlannerDisposedError());
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function checkedNextOrdinal(value: number): number {
  if (value >= MAX_U32) throw new RangeError('text handles are exhausted');
  return value + 1;
}

function checkedNextCheckpointGeneration(value: number): number {
  if (value >= MAX_U32) throw new RangeError('plan target checkpoint generation is exhausted');
  return value + 1;
}

function publicationIsCheckpoint(publication: PlanPublication): boolean {
  return (publication.flags & textShaperAbi.engine.resultFlags.checkpoint) !== 0;
}

function checkedNextStructureRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError('retained text structure revision is exhausted');
  }
  return value + 1;
}

function positiveU32(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > MAX_U32) {
    throw new RangeError(`${label} must be a positive u32`);
  }
}

function uint32(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > MAX_U32) {
    throw new RangeError(`${label} must be a u32`);
  }
}

function cloneAuthoredData<Value>(value: Value, label: string): Value {
  try {
    return structuredClone(value);
  } catch (cause) {
    throw new TypeError(`${label} must contain cloneable data`, { cause });
  }
}

function combinedFailure(primary: unknown, cleanup: unknown, message: string): AggregateError {
  return new AggregateError([primary, cleanup], message, { cause: primary });
}

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isNonArrayObject(value) && typeof value.then === 'function';
}
