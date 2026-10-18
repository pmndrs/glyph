import { sameConstraintSizes, withTextAnchor } from '../text-anchor.js';
import { textShaperAbi } from '../generated/text-shaper-abi.js';
import { GlyphError } from '../glyph-error.js';
import {
  copyGlyphLayoutInspection,
  type BorrowedGlyphLayout,
  type GlyphLayoutColumns,
  type GlyphLayoutInspection,
  type ParagraphLayoutSummary,
} from '../layout.js';
import { requireGlyphOutlineStore, storedGlyphOutline, type GlyphOutlineStore } from '../glyph-outline.js';
import {
  assertConstraints,
  assertParagraphLayout,
  assertTextStyleFeatureRanges,
  type Constraints,
  type ParagraphLayout,
  type TextStyle,
} from '../text-properties.js';
import {
  compileEngineGeometry,
  assertTextEffectsSupported,
  engineStyleId,
  engineStyleValue,
  normalizedColumns,
} from '../engine-encoding.js';
import {
  MAX_TEXT_ENGINE_OUTPUT_BYTES,
  type PlannerConstraint,
  type PlannerExclusion,
  type PlannerFrameLimits,
  type PlannerFrameUpdate,
  type PlannerInlineObject,
  type PlannerParagraphMutation,
  type PlannerRegion,
  type PlannerStyleMutation,
  type PlannerTextMutation,
} from './frame-wire.js';
import type {
  HandleFontStackBinding,
  HandleMaterialBinding,
  HandleBindingLease,
  CodecRegistration,
  HandleResourceBinding,
  HandleTransformBinding,
  GlyphHandleState,
  BorrowedLayoutPublication,
  PlanPublication,
  PlanTransport,
} from './handle-state.js';
import { RenderPlanView, type RenderPlanTable } from './plan-view.js';
import { PostCommitError } from '../glyph-error.js';
import {
  copyPreparedLayoutInspection,
  measurementFromLayoutInspection,
  readPlannerLayouts,
  readPlannerMeasurements,
} from './layout-query-view.js';
import {
  createBorrowedGlyphLayout,
  createInspectionBorrowedGlyphLayout,
  fontHandleAt,
  type OutlineDecoder,
} from './borrowed-layout-view.js';
import type { PortableResource } from '../config/resources.js';
import { reuseOrCreateTextPropertySnapshot, reuseOrCreateTextStyleSnapshot } from '../config/text-property.js';
import type { ParagraphId, ResourceHandle, StyleId } from './glyph-id.js';
import { codecCapabilitySetSelectionId, selectCodecCapabilitySet } from './codec-capability-selection.js';
import { ownTextInput } from '../config/text-span-owner.js';

const MAX_U32 = 0xffff_ffff;
const claimedTargets = new WeakSet<object>();
const EMPTY_REQUEST_ITEMS: readonly never[] = Object.freeze([]);

declare const planOriginBrand: unique symbol;
/** Unforgeable identity of the plan that produced a plan candidate. */
export interface PlanOrigin {
  readonly [planOriginBrand]: true;
}

/** Engine-owned host transform identity used only while mapping a trusted publication. */
type RenderPlanTransformId = number;

class PlanOriginImpl implements PlanOrigin {
  declare readonly [planOriginBrand]: true;
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

/** A synchronous view into engine-owned result memory. */
export interface BorrowedRenderPlan extends RenderPlanReader {
  readonly delivery: 'borrowed';
}

/** One renderer-neutral payload resolved from a plan resource reference. */
export interface ResolvedPortablePayload {
  readonly referenceId: ResourceHandle;
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

/** A plan transform resolved to its handle-owned binding. */
export interface ResolvedPlanTransform {
  /** Physical transform-table record consumed by indexed renderer buffers. */
  readonly transformIndex: RenderPlanTransformId;
  /** Root draw identities that select the same host transform without entering the transform table. */
  readonly instanceIds?: readonly ParagraphId[];
  readonly binding: HandleTransformBinding;
}

/** A synchronous candidate whose borrowed plan must be consumed during `accept`. */
export interface PlanCandidate {
  readonly origin: PlanOrigin;
  readonly plan: BorrowedRenderPlan;
  readonly engineRevision: number;
  readonly revision: number;
  readonly publicationGeneration: number;
  /** Whether this publication is a complete renderer checkpoint rather than an incremental update. */
  readonly checkpoint: boolean;
  /** Producer proof that host draw topology remains unchanged while metadata may be refreshed. */
  readonly retainedHostTopology: boolean;
  readonly transforms: readonly ResolvedPlanTransform[];
  acquirePayload(referenceId: ResourceHandle): PortablePayloadLease;
  resolveMaterial(materialId: number): HandleMaterialBinding;
  resolveResource(resourceId: ResourceHandle): HandleResourceBinding;
}

/** The renderer's transactional decision for one candidate. */
export type PlanAcceptance = Readonly<{ accepted: true }> | Readonly<{ accepted: false; error: unknown }>;

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
  readonly key: string;
  readonly transform: HandleTransformBinding;
};

/** An exclusion authored relative to its containing flow region. */
export type RetainedTextExclusionInput = Omit<PlannerExclusion, 'id' | 'regionId' | 'geometryRevision'> & {
  readonly key: string;
};

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
export type RetainedTextUpdate = {
  readonly font?: HandleFontStackBinding;
  readonly text?: RetainedTextInput;
  readonly material?: HandleMaterialBinding | undefined;
  readonly transform?: HandleTransformBinding | undefined;
  readonly order?: number | undefined;
  readonly rasterPixelRatio?: number | undefined;
  readonly style?: TextStyle | undefined;
  readonly layout?: ParagraphLayout | undefined;
  readonly constraints?: Constraints | undefined;
  readonly flow?: RetainedTextFlowInput | undefined;
  readonly inlineObjects?: readonly RetainedTextInlineObjectInput[] | undefined;
};

/** One planner-owned retained text instance. */
export interface RetainedText {
  readonly disposed: boolean;
  update(update: RetainedTextUpdate): void;
  /** Repositions this paragraph without invalidating its semantic or measured state. */
  updateOrder(order: number, orderScope: number, orderRank: number): void;
  /** Returns aggregate metrics from the preparation synchronously completed by the latest assignment. */
  measure(): ParagraphLayoutSummary;
  /** Returns aggregate metrics with authoritative positioned ink bounds. */
  measureInk(): ParagraphLayoutSummary;
  /** Copies caller-owned columns from the latest prepared positioned glyphs. */
  glyphs(): GlyphLayoutInspection;
  /** Demand-reads positioned glyphs through a synchronous expiring view. */
  readGlyphs<Result>(read: (glyphs: BorrowedGlyphLayout) => Result): Result;
  /** Offers a complete checkpoint containing selected desired-layout stable glyph ids to one renderer target. */
  copyGlyphs(stableIds: ArrayLike<number>, target: PlanTarget): PlanAcceptance;
  /** Offers a complete checkpoint containing this paragraph's desired decorations. */
  copyDecorations(target: PlanTarget): PlanAcceptance;
  dispose(): void;
}

/** Optional semantic views to cache while compiling the next publication. */
export interface RenderPlannerPublishOptions {
  readonly semanticViews?: 'none' | 'measurement' | 'layout-inspection' | 'all';
}

/** One retained-text planner staged only through the engine-wide shape batch. */
export interface RenderPlanner {
  readonly disposed: boolean;
  /** @internal Rejects lifecycle mutation while this planner owns a staged publication. */
  assertMutationAllowed(): void;
  /** Creates one retained text instance in this planner. */
  createText(options: RetainedTextOptions): RetainedText;
  /** Disposes every retained text instance and releases this planner. */
  dispose(): void;
}

/** Construction options for one retained-text planner and render target. */
export interface RenderPlannerOptions {
  readonly codec: CodecRegistration;
  readonly capabilitySetIndex: number;
  readonly target: (control: PlanTargetControl) => PlanTarget;
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

/** @internal Planner construction shared by retained roots and explicit single-Text queries. */
export interface MeasurementPlannerOptions {
  readonly codec: CodecRegistration;
  readonly limits: RenderPlannerLimits;
  readonly requestCapacity: number;
  readonly resultCapacity: number;
  readonly textCapacity: number;
}

/** Thrown when a render planner is used after disposal. */
export class RenderPlannerDisposedError extends GlyphError<'engine-failed'> {
  constructor() {
    super('engine-failed', 'render planner has been disposed');
    this.name = 'RenderPlannerDisposedError';
  }
}

interface ResolvedSpan {
  readonly start: number;
  readonly end: number;
  readonly font: ReturnType<GlyphHandleState['_retainFontStackBinding']> | undefined;
  readonly material: HandleBindingLease<HandleMaterialBinding> | undefined;
  readonly style: TextStyle | undefined;
}

interface ResolvedTextOptions {
  readonly source: RetainedTextOptions;
  readonly ownership: ResolvedTextOwnership;
  readonly text: string;
  readonly spans: readonly ResolvedSpan[];
  readonly font: ReturnType<GlyphHandleState['_retainFontStackBinding']>;
  readonly material: HandleBindingLease<HandleMaterialBinding> | undefined;
  readonly transform: HandleBindingLease<HandleTransformBinding>;
  readonly flowTransforms: readonly HandleBindingLease<HandleTransformBinding>[];
  readonly inlineMaterials: readonly HandleBindingLease<HandleMaterialBinding>[];
  readonly inlineResources: readonly HandleBindingLease<HandleResourceBinding>[];
}

type RetainedStyleChange =
  | Readonly<{ kind: 'root' }>
  | Readonly<{ kind: 'span'; styleIndex: number; cascadeOrder: number; span: ResolvedSpan }>
  | Readonly<{ kind: 'remove'; styleIndex: number }>;

const noRetainedStyleChanges: readonly RetainedStyleChange[] = Object.freeze([]);

interface OwnedTextInspection {
  readonly kind: 'owned';
  readonly columns: GlyphLayoutInspection;
}

/** @internal Canonical inspection columns for an integration's synchronous derived query. */
export interface OwnedTextInspectionView {
  readonly columns: GlyphLayoutInspection;
  readonly readyToDraw: boolean;
}

type TextInspection = OwnedTextInspection | { readonly kind: 'borrowed'; recordReads: number };

interface RetainedTextState {
  readonly paragraphId: ParagraphId;
  readonly ordinal: number;
  readonly styleIds: StyleId[];
  desired: ResolvedTextOptions;
  metrics: RetainedTextMetrics;
  preparedText: string;
  preparedOrder: number;
  prepared: boolean;
  styleChanges: readonly RetainedStyleChange[];
  geometryRevision: number;
  committedFlowRegions: Map<string, CommittedFlowRegion>;
  committedFlowExclusions: Map<string, CommittedFlowExclusion>;
  pendingFlowRegions: Map<string, CommittedFlowRegion>;
  pendingFlowExclusions: Map<string, CommittedFlowExclusion>;
  published: boolean;
  dirty: boolean;
  lifecycleDirty: boolean;
  geometryDirty: boolean;
  orderScope: number;
  orderRank: number;
  orderDirty: boolean;
  removed: boolean;
  disposed: boolean;
  desiredReleased: boolean;
  committed: ResolvedTextOptions | undefined;
  measurement: ParagraphLayoutSummary | undefined;
  inspection: TextInspection | undefined;
}

interface CommittedFlowRegion {
  readonly input: RetainedTextRegionInput;
  readonly transformHandle: number;
  readonly revision: number;
}

interface CommittedFlowExclusion {
  readonly input: RetainedTextExclusionInput;
  readonly revision: number;
}

interface RetainedTextMetrics {
  readonly order: number;
  readonly styleCount: number;
  readonly regionCount: number;
  readonly exclusionCount: number;
  readonly inlineObjectCount: number;
}

type RetainedTextLimitState = Pick<RetainedTextState, 'desired' | 'metrics' | 'dirty' | 'styleChanges'>;

interface ResolvedPublicationTransforms {
  readonly transforms: readonly ResolvedPlanTransform[];
  readonly retainedHostTopology: boolean;
}

interface PendingPublication {
  readonly publication: PlanPublication;
  readonly transforms: ResolvedPublicationTransforms;
  readonly checkpointGeneration: number;
}

interface StagedBatchPublication {
  readonly checkpointGeneration: number;
  readonly semanticViewMask: number;
}

/** @internal One retained synchronous planner staged for the engine-wide shape batch. */
export interface StagedRenderPlanner {
  readonly rootId: number;
  readonly requestLength: number;
  adopt(resultPointer: number, memoryBuffer: ArrayBuffer): void;
  consume(): PlanAcceptance;
  settle(): void;
  discard(): void;
}

const textStates = new WeakMap<object, Readonly<{ planner: RenderPlannerImpl; state: RetainedTextState }>>();

/** @internal Constructed only after GlyphHandleState validates handle ownership. */
export function createRenderPlanner(handleState: GlyphHandleState, options: RenderPlannerOptions): RenderPlanner {
  return new RenderPlannerImpl(handleState, options);
}

/** @internal Resolves the retained identity and reads its planner-owned inspection without exposing mutable columns. */
export function ownedTextInspection(text: RetainedText): OwnedTextInspectionView {
  const retained = textStates.get(text);
  if (retained === undefined) throw new TypeError('text engine text is not retained by this planner');
  return retained.planner._ownedInspection(retained.state);
}

/** @internal Construct a query planner without a renderer acceptance target. */
export function createMeasurementPlanner(
  handleState: GlyphHandleState,
  options: MeasurementPlannerOptions,
): MeasurementPlanner {
  return new RenderPlannerImpl(handleState, options, true);
}

/** @internal Schedule callbacks for semantic mutations on one package-created renderer planner. */
export function observeRenderPlannerDirty(planner: RenderPlanner, listener: () => void): () => void {
  if (!(planner instanceof RenderPlannerImpl)) throw new TypeError('render planner was not created by this package');
  return planner._observeDirty(listener);
}

/** @internal Stage one synchronous root without crossing into Wasm. */
export function stageRenderPlanner(
  planner: RenderPlanner,
  options?: RenderPlannerPublishOptions,
  force = false,
): StagedRenderPlanner | undefined {
  if (!(planner instanceof RenderPlannerImpl)) throw new TypeError('render planner was not created by this package');
  return planner._stageBatch(normalizePublishOptions(options), force);
}

class RenderPlannerImpl {
  readonly #handleState: GlyphHandleState;
  readonly #transport: PlanTransport;
  readonly #codec: ReturnType<GlyphHandleState['_retainInstalledCodec']>;
  readonly #capabilitySet: ReturnType<typeof selectCodecCapabilitySet> | undefined;
  readonly #target: PlanTarget | undefined;
  readonly #control: TargetControlState | undefined;
  readonly #targetController = new AbortController();
  readonly #origin: PlanOrigin = Object.freeze(new PlanOriginImpl());
  readonly #limits: RenderPlannerLimits;
  readonly #texts = new Set<RetainedTextState>();
  // Accepted setters already prepared Rust; retain only owners awaiting publication adoption.
  readonly #pendingTexts = new Set<RetainedTextState>();
  #transforms: readonly ResolvedPlanTransform[] | undefined;
  readonly #removed = new Set<RetainedTextState>();
  readonly #preparationRemovals = new Set<RetainedTextState>();
  // Indexes only the base order currently installed in Rust. Desired renderer order remains
  // state.metrics.order and is validated once over the complete publication transaction.
  readonly #preparedOrderOwners = new Map<number, RetainedTextState>();
  #baseOrderValidationPending = false;
  #liveTextCount = 0;
  #liveStyleCount = 0;
  #liveRegionCount = 0;
  #liveExclusionCount = 0;
  #liveInlineObjectCount = 0;
  #nextTextOrdinal = 1;
  #nextTemporaryPreparationOrder = MAX_U32;
  #engineRevision = 0;
  #revision = 0;
  #acknowledgedGeneration = 0;
  #checkpointGeneration = 0;
  #acceptedCheckpointGeneration = 0;
  #disposed = false;
  #engineNeedsRebuild = false;
  #stagedBatch: StagedBatchPublication | undefined;
  #stagedRequestLength = 0;
  #stagedPublication: PendingPublication | undefined;
  #stagedAcceptance: PendingPublication | undefined;
  #dirtyListener: (() => void) | undefined;

  constructor(
    handleState: GlyphHandleState,
    options: RenderPlannerOptions | MeasurementPlannerOptions,
    measurementOnly = false,
  ) {
    this.#handleState = handleState;
    if (measurementOnly) assertMeasurementPlanOptions(options);
    else assertRenderPlannerOptions(options);
    this.#limits = snapshotLimits(options.limits);
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
        return;
      } catch (error) {
        codec.dispose();
        throw error;
      }
    }
    const renderOptions = options as RenderPlannerOptions;
    let target: PlanTarget | undefined;
    let claimed = false;
    const control = new TargetControlState(() => {
      this.#assertActive();
      this.#checkpointGeneration = checkedNextCheckpointGeneration(this.#checkpointGeneration);
      this.#dirtyListener?.();
    });
    try {
      const capabilitySet = codec.descriptor.capabilitySets[renderOptions.capabilitySetIndex];
      if (capabilitySet === undefined) throw new RangeError('Codec capability set index is out of range');
      const selectedCapabilitySet = selectCodecCapabilitySet(codec.handle, codec.descriptor, capabilitySet);
      target = renderOptions.target(control);
      assertTarget(target);
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
      this.#capabilitySet = selectedCapabilitySet;
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

  assertMutationAllowed(): void {
    // This is a guard called from lifecycle/dirty callbacks, not an engine operation. In
    // particular it must not replay accepted state reentrantly while a setter is still
    // installing that state.
    this.#assertMutable();
    this.#transport.assertMutationAllowed();
  }

  createText(options: RetainedTextOptions): RetainedText {
    this.#assertPublicationMutationAllowed();
    const ordinal = this.#nextTextOrdinal;
    const nextOrdinal = checkedNextOrdinal(ordinal);
    const desired = resolveTextOptions(this.#handleState, options);
    const paragraphId = this.#handleState.id('paragraph', `${this.#handleState.integration}/text/${ordinal}`);
    const state: RetainedTextState = {
      paragraphId,
      ordinal,
      styleIds: [],
      desired,
      metrics: retainedTextMetrics(desired, ordinal),
      preparedText: '',
      preparedOrder: 0,
      prepared: false,
      styleChanges: retainedStyleChanges(desired),
      geometryRevision: 0,
      committedFlowRegions: new Map(),
      committedFlowExclusions: new Map(),
      pendingFlowRegions: new Map(),
      pendingFlowExclusions: new Map(),
      published: false,
      dirty: true,
      lifecycleDirty: true,
      geometryDirty: true,
      orderScope: 0,
      orderRank: 0,
      orderDirty: false,
      removed: false,
      disposed: false,
      desiredReleased: false,
      committed: undefined,
      measurement: undefined,
      inspection: undefined,
    };
    let candidatePrepared = false;
    try {
      state.preparedOrder = this.#preparationOrderForCreation(state.metrics.order);
      this.#validateAggregateLimits(state);
      this.#ensureEngineRebuilt();
      this.#prepareTextCandidate(state);
      candidatePrepared = true;
    } catch (error) {
      this.#invalidateUnadoptedPreparation();
      if (candidatePrepared) this.#engineNeedsRebuild = true;
      releaseResolvedText(desired);
      throw error;
    }
    const previousBaseOrderValidationPending = this.#baseOrderValidationPending;
    state.prepared = true;
    state.preparedText = desired.text;
    state.lifecycleDirty = state.preparedOrder !== state.metrics.order;
    state.styleChanges = noRetainedStyleChanges;
    state.geometryDirty = false;
    const text = new RetainedTextImpl(this, state);
    textStates.set(text, { planner: this, state });
    this.#claimPreparedOrder(state);
    this.#addLiveState(state);
    this.#texts.add(state);
    this.#transforms = undefined;
    this.#pendingTexts.add(state);
    this.#baseOrderValidationPending = true;
    this.#nextTextOrdinal = nextOrdinal;
    this.#transport.acceptPreparedMutation();
    try {
      this.#dirtyListener?.();
    } catch (error) {
      this.#texts.delete(state);
      this.#pendingTexts.delete(state);
      this.#removeLiveState(state);
      this.#releasePreparedOrder(state);
      textStates.delete(text);
      state.disposed = true;
      state.desiredReleased = true;
      releaseResolvedText(desired);
      this.#nextTextOrdinal = ordinal;
      this.#baseOrderValidationPending = previousBaseOrderValidationPending;
      this.#engineNeedsRebuild = true;
      throw new Error('text creation failed after preparing its candidate; the candidate was discarded', {
        cause: error,
      });
    }
    return text;
  }

  /** @internal */
  _updateText(state: RetainedTextState, update: RetainedTextUpdate): { error: unknown } | undefined {
    this.#assertPublicationMutationAllowed();
    if (state.disposed) throw new Error('text engine text has been disposed');
    if (!isNonArrayObject(update)) throw new TypeError('text engine text update must be an object');
    const textOnly = textOnlyUpdate(update, state.desired);
    if (textOnly !== undefined && textOnly === state.desired.text && !this.#engineNeedsRebuild) return;
    const desired =
      textOnly === undefined
        ? resolveTextOptions(
            this.#handleState,
            mergeRetainedTextOptions(state.desired.source, state.metrics.order, update),
            state.desired,
          )
        : forkResolvedTextWithText(state.desired, textOnly, state.metrics.order);
    // After renderer rejection, even an anchor edit must retry the engine's unaccepted output.
    if (
      !this.#isDirty() &&
      !this.#engineNeedsRebuild &&
      state.published &&
      state.committed === state.desired &&
      this.#engineRevision === this.#revision &&
      sameTextExceptAnchor(state.desired, desired, state.ordinal)
    ) {
      const anchor = desired.source.constraints?.anchor;
      let measurement: ParagraphLayoutSummary | undefined;
      let inspection: TextInspection | undefined;
      try {
        measurement = state.measurement === undefined ? undefined : withTextAnchor(state.measurement, anchor);
        inspection =
          state.inspection?.kind === 'owned'
            ? {
                ...state.inspection,
                columns: this.#inspectionColumns(withTextAnchor(state.inspection.columns, anchor)),
              }
            : state.inspection;
      } catch (error) {
        releaseResolvedText(desired);
        throw error;
      }
      const previousDesired = state.desired;
      const previousCommitted = state.committed!;
      // The accepted geometry and bindings are unchanged; own the new semantic identity for
      // both the desired and committed references before any old lease can be released.
      retainResolvedText(desired);
      state.desired = desired;
      state.committed = desired;
      state.measurement = measurement;
      state.inspection = inspection;
      let postCommitError: unknown;
      let postCommitFailed = false;
      for (const previous of [previousDesired, previousCommitted]) {
        try {
          releaseResolvedText(previous);
        } catch (error) {
          if (!postCommitFailed) postCommitError = error;
          postCommitFailed = true;
        }
      }
      try {
        this.#dirtyListener?.();
      } catch (error) {
        if (!postCommitFailed) postCommitError = error;
        postCommitFailed = true;
      }
      if (postCommitFailed) {
        return {
          error: new PostCommitError('text anchor update was accepted, but a post-commit step failed', postCommitError),
        };
      }
      return;
    }
    const metrics = retainedTextMetrics(desired, state.ordinal);
    const styleChanges =
      desired.text.length !== state.desired.text.length || updateChangesStyle(update, state.desired, desired)
        ? retainedStyleChanges(desired, state.desired)
        : noRetainedStyleChanges;
    const geometryDirty =
      desired.transform.handle !== state.desired.transform.handle ||
      desired.source.layout !== state.desired.source.layout ||
      !sameConstraintSizes(desired.source.constraints, state.desired.source.constraints) ||
      (Object.hasOwn(update, 'flow') && (update.flow !== undefined || state.desired.source.flow !== undefined)) ||
      (Object.hasOwn(update, 'inlineObjects') &&
        (update.inlineObjects !== undefined || state.desired.source.inlineObjects !== undefined));
    const previousOrder = state.metrics.order;
    const nextOrder = metrics.order;
    const lifecycleDirty = state.lifecycleDirty || previousOrder !== nextOrder;
    const candidate: RetainedTextLimitState = {
      desired,
      metrics,
      dirty: true,
      styleChanges,
    };
    const wasPending = this.#pendingTexts.has(state);
    let preparation: RetainedTextState;
    let preparedRevisionChanged: boolean;
    let candidatePrepared = false;
    try {
      this.#validateAggregateLimits(candidate, state);
      this.#ensureEngineRebuilt();
      preparation = {
        ...state,
        desired,
        metrics,
        styleChanges,
        // Existing paragraph order belongs to the publication transaction. Setter preparation
        // updates this paragraph's semantic state without exposing half of an atomic order swap.
        lifecycleDirty: false,
        geometryDirty,
        pendingFlowRegions: geometryDirty ? new Map() : state.pendingFlowRegions,
        pendingFlowExclusions: geometryDirty ? new Map() : state.pendingFlowExclusions,
      };
      preparedRevisionChanged = this.#prepareTextCandidate(preparation);
      candidatePrepared = true;
    } catch (error) {
      this.#invalidateUnadoptedPreparation();
      if (candidatePrepared) this.#engineNeedsRebuild = true;
      if (!wasPending) this.#pendingTexts.delete(state);
      releaseResolvedText(desired);
      throw error;
    }

    const previousDesired = state.desired;
    const transformsChanged =
      desired.transform.handle !== previousDesired.transform.handle ||
      desired.flowTransforms.length !== previousDesired.flowTransforms.length ||
      desired.flowTransforms.some(
        (transform, index) => transform.handle !== previousDesired.flowTransforms[index]!.handle,
      );
    this.#replaceLiveState(state, metrics);
    state.desired = desired;
    state.metrics = metrics;
    if (transformsChanged) this.#transforms = undefined;
    state.preparedText = preparation.preparedText;
    state.prepared = true;
    state.dirty = true;
    state.lifecycleDirty = lifecycleDirty;
    state.styleChanges = noRetainedStyleChanges;
    state.geometryDirty = false;
    state.geometryRevision = preparation.geometryRevision;
    state.committedFlowRegions = preparation.committedFlowRegions;
    state.committedFlowExclusions = preparation.committedFlowExclusions;
    state.pendingFlowRegions = preparation.pendingFlowRegions;
    state.pendingFlowExclusions = preparation.pendingFlowExclusions;
    state.measurement = preparation.measurement;
    if (preparedRevisionChanged) state.inspection = undefined;
    else if (state.inspection?.kind === 'owned') {
      state.inspection = {
        kind: 'owned',
        columns: this.#inspectionColumns(withTextAnchor(state.inspection.columns, desired.source.constraints?.anchor)),
      };
    }
    this.#pendingTexts.add(state);
    if (previousOrder !== nextOrder) {
      this.#baseOrderValidationPending = true;
    }
    this.#transport.acceptPreparedMutation();
    // Both operations are post-commit: attempt lease release and dirty notification before
    // reporting the first failure as occurring after acceptance.
    let postCommitError: unknown;
    let postCommitFailed = false;
    try {
      releaseResolvedText(previousDesired);
    } catch (error) {
      postCommitError = error;
      postCommitFailed = true;
    }
    try {
      this.#dirtyListener?.();
    } catch (error) {
      if (!postCommitFailed) postCommitError = error;
      postCommitFailed = true;
    }
    if (postCommitFailed) {
      return {
        error: new PostCommitError('text update was accepted, but a post-commit step failed', postCommitError),
      };
    }
    return undefined;
  }

  /** @internal */
  _updateTextOrder(state: RetainedTextState, order: number, orderScope: number, orderRank: number): void {
    this.#assertPublicationMutationAllowed();
    if (state.disposed) throw new Error('text engine text has been disposed');
    uint32(order, 'text order');
    uint32(orderScope, 'text order scope');
    if (!Number.isFinite(orderRank)) throw new RangeError('text order rank must be finite');
    if (state.metrics.order === order && state.orderScope === orderScope && Object.is(state.orderRank, orderRank)) {
      return;
    }
    if (!state.dirty && this.#removed.size + this.#pendingTexts.size + 1 > this.#limits.maxParagraphs * 2) {
      throw new RangeError('pending paragraph mutations exceed limits.maxParagraphs');
    }
    const lifecycleOrderChanged = state.metrics.order !== order;
    const scopedOrderChanged = state.orderScope !== orderScope || !Object.is(state.orderRank, orderRank);
    if (lifecycleOrderChanged) {
      state.metrics = { ...state.metrics, order };
      this.#baseOrderValidationPending = true;
    }
    state.orderScope = orderScope;
    state.orderRank = orderRank;
    state.dirty = true;
    state.lifecycleDirty = state.lifecycleDirty || lifecycleOrderChanged;
    state.orderDirty = state.orderDirty || scopedOrderChanged;
    this.#pendingTexts.add(state);
    this.#dirtyListener?.();
  }

  /** @internal */
  _layoutText(state: RetainedTextState): ParagraphLayoutSummary {
    this.#assertTextQueryable(state);
    return requirePreparedMeasurement(state);
  }

  /** @internal Resolves positioned ink only when a host explicitly asks for it. */
  _layoutTextWithInk(state: RetainedTextState): ParagraphLayoutSummary {
    this.#assertTextQueryable(state);
    const measurement = requirePreparedMeasurement(state);
    if (measurement.inkBounds !== undefined || measurement.glyphCount === 0) return measurement;
    const inspection = this._ownedInspection(state);
    state.measurement = measurementFromLayoutInspection(inspection.columns);
    return state.measurement;
  }

  /** @internal */
  _inspectText(state: RetainedTextState): GlyphLayoutInspection {
    const inspection = this._ownedInspection(state);
    return copyGlyphLayoutInspection(inspection.columns, inspection.columns.outlineAt);
  }

  /** @internal Gives Three the canonical private columns plus the current renderer-readiness fact. */
  _ownedInspection(state: RetainedTextState): OwnedTextInspectionView {
    this.#assertTextQueryable(state);
    let inspection = state.inspection?.kind === 'owned' ? state.inspection : undefined;
    if (inspection === undefined) {
      inspection = this.#ownInspection(state, this.#transport.borrowParagraphLayout(state.paragraphId));
    }
    return {
      columns: inspection.columns,
      readyToDraw:
        state.published &&
        state.committed === state.desired &&
        this.#checkpointGeneration === this.#acceptedCheckpointGeneration,
    };
  }

  #inspectionColumns(layout: GlyphLayoutColumns): GlyphLayoutInspection {
    // Copies share font stores so their outlines outlive the source handle.
    const stores = new Map<number, GlyphOutlineStore | undefined>();
    for (const fontHandle of layout.fontHandles)
      stores.set(fontHandle, this.#handleState._glyphOutlineStore(fontHandle));
    const outlineAt: GlyphLayoutInspection['outlineAt'] = (index) =>
      storedGlyphOutline(
        requireGlyphOutlineStore(stores.get(fontHandleAt(layout, index))),
        layout.glyphIds[index]!,
      ).slice();
    const inspection = { ...layout, outlineAt };
    Object.defineProperty(inspection, 'outlineAt', { enumerable: false });
    return Object.freeze(inspection);
  }

  #ownInspection(state: RetainedTextState, publication: BorrowedLayoutPublication): OwnedTextInspection {
    if (state.inspection?.kind === 'owned') return state.inspection;
    const inspection: OwnedTextInspection = {
      kind: 'owned',
      columns: this.#inspectionColumns(
        withTextAnchor(
          copyPreparedLayoutInspection(requirePreparedMeasurement(state), this.#transport, publication),
          state.desired.source.constraints?.anchor,
        ),
      ),
    };
    state.inspection = inspection;
    return inspection;
  }

  /** @internal */
  _readGlyphs<Result>(state: RetainedTextState, read: (glyphs: BorrowedGlyphLayout) => Result): Result {
    this.#assertTextQueryable(state);
    if (typeof read !== 'function') throw new TypeError('borrowed glyph inspection callback must be a function');
    let active = true;
    let glyphs: BorrowedGlyphLayout;
    let publication: BorrowedLayoutPublication | undefined;
    const inspection = state.inspection;
    const assertActive = (): void => {
      if (!active) throw new Error('borrowed glyph layout has expired');
    };
    const decodeOutline: OutlineDecoder = (fontHandle, glyphId, target) =>
      this.#handleState._glyphOutline(fontHandle, glyphId, target);
    if (inspection?.kind === 'owned') {
      glyphs = createInspectionBorrowedGlyphLayout(inspection.columns, assertActive, decodeOutline);
    } else {
      const descriptor = this.#transport.borrowParagraphLayout(state.paragraphId);
      publication = descriptor;
      const demand = inspection ?? { kind: 'borrowed' as const, recordReads: 0 };
      state.inspection = demand;
      glyphs = createBorrowedGlyphLayout(this.#transport, descriptor, assertActive, decodeOutline, () => {
        if (demand.recordReads < descriptor.glyphCount) demand.recordReads += 1;
      });
    }
    const leaveBorrow = this.#handleState._enterBorrowedPlan();
    try {
      if (
        state.inspection?.kind === 'borrowed' &&
        state.inspection.recordReads > 0 &&
        state.inspection.recordReads >= glyphs.glyphCount &&
        publication !== undefined
      ) {
        const owned = this.#ownInspection(state, publication);
        glyphs = createInspectionBorrowedGlyphLayout(owned.columns, assertActive, decodeOutline);
      }
      const result = read(glyphs);
      if (isPromiseLike(result)) throw new TypeError('a borrowed glyph inspection callback must answer synchronously');
      return result;
    } finally {
      active = false;
      leaveBorrow();
    }
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
    this.#assertPublicationMutationAllowed();
    state.disposed = true;
    state.styleIds.length = 0;
    this.#transforms = undefined;
    this.#removeLiveState(state);
    // Rust preparation still owns these bindings until the queued removal is consumed.
    // Publication adoption or root teardown releases them after removing that reference.
    state.removed = true;
    state.dirty = true;
    this.#removed.add(state);
    this.#preparationRemovals.add(state);
    this.#dirtyListener?.();
  }

  /** @internal */
  _observeDirty(listener: () => void): () => void {
    this.#assertActive();
    if (typeof listener !== 'function') throw new TypeError('render planner dirty listener must be a function');
    if (this.#dirtyListener !== undefined) throw new Error('render planner already has a dirty listener');
    this.#dirtyListener = listener;
    if (this.#isDirty()) listener();
    return () => {
      if (this.#dirtyListener === listener) this.#dirtyListener = undefined;
    };
  }

  /** @internal */
  _stageBatch(options: NormalizedPublishOptions, force: boolean): StagedRenderPlanner | undefined {
    this.#assertMutable();
    this.#ensureEngineRebuilt();
    if (this.#target === undefined) throw new Error('measurement-only planners cannot publish render plans');
    if (this.#target.delivery !== 'borrowed') {
      throw new TypeError('glyph.shape() requires a synchronous borrowed renderer target');
    }
    if (this.#stagedBatch !== undefined) throw new Error('render planner is already staged');
    if (!force && !this.#isDirty()) return undefined;
    const checkpointGeneration = this.#checkpointGeneration;
    const frame = this.#compileFrame(options, checkpointGeneration);
    this.#stagedRequestLength = this.#transport.stageUpdate(frame);
    this.#stagedBatch = { checkpointGeneration, semanticViewMask: options.semanticViewMask };
    return this;
  }

  get rootId(): number {
    if (this.#stagedBatch === undefined) throw new Error('render planner is not staged');
    return this.#transport.handle;
  }

  get requestLength(): number {
    if (this.#stagedBatch === undefined) throw new Error('render planner is not staged');
    return this.#stagedRequestLength;
  }

  adopt(resultPointer: number, memoryBuffer: ArrayBuffer): void {
    const staged = this.#stagedBatch;
    if (staged === undefined) throw new Error('render planner is not staged');
    if (this.#stagedPublication !== undefined) throw new Error('render planner already adopted a staged publication');
    this.#stagedBatch = undefined;
    this.#stagedRequestLength = 0;
    try {
      const publication = this.#transport.consumeStagedUpdate(resultPointer, memoryBuffer);
      this.#engineRevision = publication.engineRevision;
      this.#cacheSemanticViews(publication, staged.semanticViewMask);
      const transforms = this.#resolvedTransforms();
      this.#commitDesiredState();
      this.#stagedPublication = { publication, transforms, checkpointGeneration: staged.checkpointGeneration };
      this.#transport.acceptPreparedMutation();
    } catch (error) {
      // Rebuild if Rust rejected by invalidating its root, or if Rust committed a candidate that
      // the TypeScript owner could not adopt. Renderer rejection happens later in consume() and
      // leaves this now-adopted engine state intact.
      this.#engineNeedsRebuild =
        this.#transport.invalidateUnadoptedMutation() || this.#transport.failureInvalidatedRoot;
      throw error;
    }
  }

  consume(): PlanAcceptance {
    const pending = this.#stagedPublication;
    if (pending === undefined) throw new Error('render planner has no adopted staged publication to consume');
    this.#stagedPublication = undefined;
    const { publication } = pending;
    const lease = new BorrowedPlanLease(publication, this.#transport);
    const candidate = this.#candidate(lease, pending.transforms);
    let result: PlanAcceptance;
    try {
      const answer = (this.#target as PlanTarget).accept(candidate, this.#targetController.signal);
      if (isPromiseLike(answer)) throw new TypeError('a borrowed plan target must answer synchronously');
      result = assertAcceptance(answer);
    } catch (error) {
      // A target rejection leaves the prepared Rust state valid. Request a full renderer
      // checkpoint on the next explicit publish, without replaying accepted text or scheduling
      // an implicit retry from a read.
      this.#checkpointGeneration = checkedNextCheckpointGeneration(this.#checkpointGeneration);
      throw error;
    } finally {
      lease.expire();
    }
    if (result.accepted) this.#stagedAcceptance = pending;
    else this.#checkpointGeneration = checkedNextCheckpointGeneration(this.#checkpointGeneration);
    return result;
  }

  settle(): void {
    const pending = this.#stagedAcceptance;
    if (pending === undefined) throw new Error('render planner has no accepted staged publication to settle');
    this.#stagedAcceptance = undefined;
    this.#accept(pending);
  }

  discard(): void {
    this.#stagedPublication = undefined;
    this.#stagedAcceptance = undefined;
    if (this.#stagedBatch === undefined) return;
    this.#stagedBatch = undefined;
    this.#stagedRequestLength = 0;
    this.#engineNeedsRebuild = true;
    this.#transport.discardStagedUpdate();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#assertPublicationMutationAllowed();
    this.#disposed = true;
    this.#transforms = undefined;
    this.#dirtyListener = undefined;
    this.discard();
    this.#targetController.abort(new RenderPlannerDisposedError());
    this.#control?.dispose();
    let failurePresent = false;
    let failure: unknown;
    const attempt = (dispose: () => void): void => {
      try {
        dispose();
      } catch (error) {
        if (!failurePresent) {
          failurePresent = true;
          failure = error;
        }
      }
    };
    if (this.#target !== undefined) attempt(() => this.#target!.dispose());
    attempt(() => this.#transport.dispose());
    for (const state of this.#texts) {
      state.disposed = true;
      state.styleIds.length = 0;
      if (!state.desiredReleased) attempt(() => releaseResolvedText(state.desired));
      state.desiredReleased = true;
      if (state.committed !== undefined) attempt(() => releaseResolvedText(state.committed!));
      state.committed = undefined;
    }
    this.#texts.clear();
    this.#removed.clear();
    this.#preparationRemovals.clear();
    this.#preparedOrderOwners.clear();
    this.#liveTextCount = 0;
    this.#liveStyleCount = 0;
    this.#liveRegionCount = 0;
    this.#liveExclusionCount = 0;
    this.#liveInlineObjectCount = 0;
    this.#pendingTexts.clear();
    attempt(() => this.#codec.dispose());
    this.#handleState._detachPlanner(this);
    if (failurePresent) throw failure;
  }

  #cacheSemanticViews(publication: PlanPublication, semanticViewMask: number): void {
    const masks = textShaperAbi.engine.semanticViewMasks;
    if ((semanticViewMask & masks.layoutInspection) !== 0) {
      const layouts = readPlannerLayouts(publication);
      for (const state of this.#texts) {
        const layout = layouts.get(state.paragraphId);
        if (layout === undefined) continue;
        const anchored = withTextAnchor(layout, state.desired.source.constraints?.anchor);
        state.measurement = measurementFromLayoutInspection(anchored);
        state.inspection = { kind: 'owned', columns: this.#inspectionColumns(anchored) };
      }
      return;
    }
    if ((semanticViewMask & masks.measurement) === 0) return;
    const measurements = readPlannerMeasurements(publication);
    for (const state of this.#texts) {
      const measurement = measurements.get(state.paragraphId);
      if (measurement !== undefined)
        state.measurement = withTextAnchor(measurement, state.desired.source.constraints?.anchor);
    }
  }

  #prepareTextCandidate(
    state: RetainedTextState,
    includeMeasurement = state.measurement !== undefined || state.desired.source.constraints?.anchor !== undefined,
  ): boolean {
    const styles = compileStyles(this.#handleState, state);
    const geometryChanged = state.geometryDirty || !state.prepared;
    const geometryRevision = state.geometryRevision + Number(geometryChanged);
    const geometry = geometryChanged ? compileGeometry(this.#handleState, state, 0, 0, geometryRevision) : undefined;
    const textMutation: PlannerTextMutation | undefined =
      state.preparedText === state.desired.text
        ? undefined
        : {
            paragraphId: state.paragraphId,
            start: 0,
            deleteCount: state.preparedText.length,
            insert: state.desired.text,
          };
    const preparedRemovals =
      this.#preparationRemovals.size === 0 ? EMPTY_REQUEST_ITEMS : [...this.#preparationRemovals];
    const preparationChanged =
      !state.prepared ||
      textMutation !== undefined ||
      styles.length !== 0 ||
      geometry !== undefined ||
      preparedRemovals.length !== 0;
    // Requested summaries stay current; unqueried text needs only durable layout preparation.
    if (!preparationChanged && (!includeMeasurement || state.measurement !== undefined)) {
      if (state.measurement !== undefined)
        state.measurement = withTextAnchor(state.measurement, state.desired.source.constraints?.anchor);
      return false;
    }
    const paragraphMutations: readonly PlannerParagraphMutation[] =
      state.prepared && preparedRemovals.length === 0
        ? EMPTY_REQUEST_ITEMS
        : [
            ...preparedRemovals.map((removed) => ({ opcode: 'remove' as const, paragraphId: removed.paragraphId })),
            {
              opcode: 'upsert' as const,
              paragraphId: state.paragraphId,
              order: state.preparedOrder,
            },
          ];
    const request: PlannerFrameUpdate = {
      rootId: this.#transport.handle,
      codecHandle: this.#codec.handle,
      ...(this.#capabilitySet === undefined ? {} : { capabilitySet: this.#capabilitySet }),
      expectedEngineRevision: this.#engineRevision,
      consumedRevision: this.#revision,
      acknowledgedPublicationGeneration: this.#acknowledgedGeneration,
      semanticViewMask: includeMeasurement
        ? textShaperAbi.engine.semanticViewMasks.measurement | textShaperAbi.engine.semanticViewMasks.borrowedLayout
        : 0,
      limits: this.#limits,
      paragraphMutations,
      paragraphOrderMutations: EMPTY_REQUEST_ITEMS,
      textMutations: textMutation === undefined ? EMPTY_REQUEST_ITEMS : [textMutation],
      styleMutations: styles,
      constraints: geometry === undefined ? EMPTY_REQUEST_ITEMS : [geometry.constraint],
      regions: geometry === undefined ? EMPTY_REQUEST_ITEMS : geometry.regions,
      exclusions: geometry === undefined ? EMPTY_REQUEST_ITEMS : geometry.exclusions,
      inlineObjects: geometryChanged
        ? compileInlineObjects(this.#handleState, state, geometryRevision)
        : EMPTY_REQUEST_ITEMS,
    };
    let measurement: ParagraphLayoutSummary | undefined;
    this.#transport.prepareParagraph(
      request,
      state.paragraphId,
      includeMeasurement
        ? (publication) => {
            measurement = readPlannerMeasurements(publication).get(state.paragraphId);
          }
        : undefined,
    );
    if (includeMeasurement && measurement === undefined)
      throw new Error('text engine returned no measurement for prepared text');
    if (geometryChanged) commitFlowEntityRevisions(state);
    state.geometryRevision = geometryRevision;
    state.preparedText = state.desired.text;
    state.measurement =
      measurement === undefined ? undefined : withTextAnchor(measurement, state.desired.source.constraints?.anchor);
    if (preparationChanged) state.inspection = undefined;
    for (const removed of preparedRemovals) {
      this.#preparationRemovals.delete(removed);
      this.#releasePreparedOrder(removed);
    }
    return preparationChanged;
  }

  #compileFrame(options: NormalizedPublishOptions, checkpointGeneration: number): PlannerFrameUpdate {
    this.#assertUniqueBaseOrders();
    const pendingTexts = [...this.#pendingTexts];
    // Semantic text, styles, and geometry were synchronously committed by the setter. Publication
    // carries only renderer lifecycle/order work and compiles that exact preparation revision.
    const paragraphMutations = [
      ...[...this.#preparationRemovals].map((state) => ({
        opcode: 'remove' as const,
        paragraphId: state.paragraphId,
      })),
      ...pendingTexts
        .filter((state) => state.lifecycleDirty)
        .map((state) => ({
          opcode: 'upsert' as const,
          paragraphId: state.paragraphId,
          order: state.metrics.order,
        })),
    ];
    const paragraphOrderMutations = pendingTexts
      .filter((state) => state.orderDirty)
      .map((state) => ({
        paragraphId: state.paragraphId,
        orderScope: state.orderScope,
        orderRank: state.orderRank,
      }));
    return {
      rootId: this.#transport.handle,
      codecHandle: this.#codec.handle,
      ...(this.#capabilitySet === undefined ? {} : { capabilitySet: this.#capabilitySet }),
      expectedEngineRevision: this.#engineRevision,
      consumedRevision: checkpointGeneration === this.#acceptedCheckpointGeneration ? this.#revision : 0,
      acknowledgedPublicationGeneration: this.#acknowledgedGeneration,
      semanticViewMask: options.semanticViewMask,
      // One Text owns one deterministic paragraph. Its compatible spans may always coalesce;
      // callers express ordering between paragraphs through the Three scene adapter.
      compositingIndependent: true,
      limits: this.#limits,
      paragraphMutations,
      paragraphOrderMutations,
      textMutations: [],
      styleMutations: [],
      constraints: [],
      regions: [],
      exclusions: [],
      inlineObjects: [],
    };
  }

  #validateAggregateLimits(candidate: RetainedTextLimitState, replacing?: RetainedTextState): void {
    const previous = replacing?.metrics;
    const liveTextCount = this.#liveTextCount + (replacing === undefined ? 1 : 0);
    const liveStyleCount = this.#liveStyleCount - (previous?.styleCount ?? 0) + candidate.metrics.styleCount;
    const regionCount = this.#liveRegionCount - (previous?.regionCount ?? 0) + candidate.metrics.regionCount;
    const exclusionCount =
      this.#liveExclusionCount - (previous?.exclusionCount ?? 0) + candidate.metrics.exclusionCount;
    const inlineObjectCount =
      this.#liveInlineObjectCount - (previous?.inlineObjectCount ?? 0) + candidate.metrics.inlineObjectCount;
    const pendingParagraphCount =
      this.#pendingTexts.size - Number(replacing !== undefined && this.#pendingTexts.has(replacing)) + 1;
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
    const maxLines = candidate.desired.source.layout?.maxLines ?? 0;
    if (maxLines > this.#limits.maxLines) throw new RangeError('retained text maxLines exceeds limits.maxLines');
    if (this.#removed.size + pendingParagraphCount > this.#limits.maxParagraphs * 2) {
      throw new RangeError('pending paragraph mutations exceed limits.maxParagraphs');
    }
    if (pendingStyleMutationCount(candidate) > this.#limits.maxClusters) {
      throw new RangeError('pending style mutations exceed limits.maxClusters');
    }
  }

  #addLiveState(state: RetainedTextState): void {
    this.#liveTextCount += 1;
    this.#liveStyleCount += state.metrics.styleCount;
    this.#liveRegionCount += state.metrics.regionCount;
    this.#liveExclusionCount += state.metrics.exclusionCount;
    this.#liveInlineObjectCount += state.metrics.inlineObjectCount;
  }

  #replaceLiveState(state: RetainedTextState, metrics: RetainedTextMetrics): void {
    this.#liveStyleCount += metrics.styleCount - state.metrics.styleCount;
    this.#liveRegionCount += metrics.regionCount - state.metrics.regionCount;
    this.#liveExclusionCount += metrics.exclusionCount - state.metrics.exclusionCount;
    this.#liveInlineObjectCount += metrics.inlineObjectCount - state.metrics.inlineObjectCount;
  }

  #removeLiveState(state: RetainedTextState): void {
    this.#liveTextCount -= 1;
    this.#liveStyleCount -= state.metrics.styleCount;
    this.#liveRegionCount -= state.metrics.regionCount;
    this.#liveExclusionCount -= state.metrics.exclusionCount;
    this.#liveInlineObjectCount -= state.metrics.inlineObjectCount;
    this.#pendingTexts.delete(state);
  }

  #commitDesiredState(): void {
    for (const state of this.#removed) {
      this.#releasePreparedOrder(state);
      this.#texts.delete(state);
      if (!state.desiredReleased) releaseResolvedText(state.desired);
      state.desiredReleased = true;
      if (state.committed !== undefined) releaseResolvedText(state.committed);
      state.committed = undefined;
    }
    this.#removed.clear();
    this.#preparationRemovals.clear();
    for (const state of this.#pendingTexts) {
      if (state.preparedOrder !== state.metrics.order) this.#releasePreparedOrder(state);
    }
    for (const state of this.#pendingTexts) {
      if (state.committed !== state.desired) {
        retainResolvedText(state.desired);
        if (state.committed !== undefined) releaseResolvedText(state.committed);
        state.committed = state.desired;
      }
      state.published = true;
      state.preparedOrder = state.metrics.order;
      this.#claimPreparedOrder(state);
      state.dirty = false;
      state.lifecycleDirty = false;
      state.styleChanges = noRetainedStyleChanges;
      state.geometryDirty = false;
      state.orderDirty = false;
      this.#pendingTexts.delete(state);
    }
    this.#baseOrderValidationPending = false;
  }

  #candidate(lease: BorrowedPlanLease, resolved = this.#resolvedTransforms()): PlanCandidate {
    return Object.freeze({
      origin: this.#origin,
      plan: lease.reader,
      engineRevision: lease.publication.engineRevision,
      revision: lease.publication.revision,
      publicationGeneration: lease.publication.publicationGeneration,
      checkpoint: publicationIsCheckpoint(lease.publication),
      retainedHostTopology:
        !publicationIsCheckpoint(lease.publication) &&
        resolved.retainedHostTopology &&
        (lease.publication.flags & textShaperAbi.engine.resultFlags.retainedHostTopology) !== 0,
      transforms: resolved.transforms,
      acquirePayload: (referenceId: ResourceHandle) => {
        lease.assertActive();
        return this.#portablePayload(referenceId);
      },
      resolveMaterial: (materialId: number) => {
        lease.assertActive();
        return this.#handleState._resolveOpaqueBinding('material', materialId);
      },
      resolveResource: (resourceId: ResourceHandle) => {
        lease.assertActive();
        return this.#handleState._resolveOpaqueBinding('resource', resourceId);
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
    if (typeof target !== 'object' || target === null || target.delivery !== 'borrowed') {
      throw new TypeError('detached plan copies require a synchronous borrowed plan target');
    }
    requirePreparedMeasurement(state);
  }

  #capabilitySetId(): number {
    return this.#capabilitySet === undefined
      ? 1
      : codecCapabilitySetSelectionId(this.#capabilitySet, this.#codec.handle);
  }

  #portablePayload(referenceId: ResourceHandle): PortablePayloadLease {
    const lease = this.#handleState._acquirePortablePayload(referenceId);
    let disposed = false;
    return Object.freeze({
      referenceId,
      techniqueId: lease.techniqueId,
      resourceName: lease.resourceName,
      payload: lease.payload,
      resources: Object.freeze(
        lease.resources.map((resource) =>
          Object.freeze({
            referenceId: resource.referenceId as ResourceHandle,
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

  #resolvedTransforms(): ResolvedPublicationTransforms {
    let retainedHostTopology = this.#removed.size === 0;
    for (const state of this.#pendingTexts) {
      const committed = state.committed;
      retainedHostTopology &&=
        committed !== undefined &&
        !state.removed &&
        !state.lifecycleDirty &&
        !state.orderDirty &&
        state.desired.transform.handle === committed.transform.handle &&
        state.desired.flowTransforms.length === committed.flowTransforms.length;
      for (const [index, transform] of state.desired.flowTransforms.entries()) {
        retainedHostTopology &&= committed?.flowTransforms[index]?.handle === transform.handle;
      }
    }
    if (this.#transforms !== undefined) return { transforms: this.#transforms, retainedHostTopology };
    const transforms = new Map<
      RenderPlanTransformId,
      { readonly binding: HandleTransformBinding; readonly instanceIds: ParagraphId[] }
    >();
    const retain = (
      transformIndex: RenderPlanTransformId,
      binding: HandleTransformBinding,
      instanceId?: ParagraphId,
    ): void => {
      let retained = transforms.get(transformIndex);
      if (retained === undefined) {
        retained = { binding, instanceIds: [] };
        transforms.set(transformIndex, retained);
      }
      if (instanceId !== undefined) retained.instanceIds.push(instanceId);
    };
    for (const state of this.#texts) {
      if (state.removed) continue;
      const rootIndex = state.desired.transform.handle;
      retain(
        rootIndex,
        this.#handleState._resolveOpaqueBinding('transform', state.desired.transform.handle),
        state.paragraphId,
      );
      for (const transform of state.desired.flowTransforms) {
        const transformIndex = transform.handle;
        retain(transformIndex, this.#handleState._resolveOpaqueBinding('transform', transform.handle));
      }
    }
    this.#transforms = Object.freeze(
      [...transforms].map(([transformIndex, { binding, instanceIds }]) =>
        Object.freeze({
          transformIndex,
          ...(instanceIds.length === 0 ? {} : { instanceIds: Object.freeze(instanceIds) }),
          binding,
        }),
      ),
    );
    return { transforms: this.#transforms, retainedHostTopology };
  }

  #assertUniqueBaseOrders(): void {
    if (!this.#baseOrderValidationPending || this.#liveTextCount <= 1) return;
    const desiredOrders = new Set<number>();
    for (const state of this.#texts) {
      if (state.removed) continue;
      const order = state.metrics.order;
      if (desiredOrders.has(order)) {
        throw new RangeError(`retained text order ${String(order)} is already in use`);
      }
      desiredOrders.add(order);
    }
  }

  #preparationOrderForCreation(desiredOrder: number): number {
    const desiredOwner = this.#preparedOrderOwners.get(desiredOrder);
    if (desiredOwner === undefined || desiredOwner.removed) return desiredOrder;
    let candidate = this.#nextTemporaryPreparationOrder;
    for (;;) {
      const owner = this.#preparedOrderOwners.get(candidate);
      if (owner === undefined || owner.removed) return candidate;
      if (candidate === 0) throw new RangeError('retained text preparation orders are exhausted');
      candidate -= 1;
    }
  }

  #claimPreparedOrder(state: RetainedTextState): void {
    this.#preparedOrderOwners.set(state.preparedOrder, state);
    if (state.preparedOrder !== state.metrics.order) {
      this.#nextTemporaryPreparationOrder = state.preparedOrder === 0 ? MAX_U32 : state.preparedOrder - 1;
    }
  }

  #releasePreparedOrder(state: RetainedTextState): void {
    if (this.#preparedOrderOwners.get(state.preparedOrder) === state) {
      this.#preparedOrderOwners.delete(state.preparedOrder);
    }
  }

  #accept({ publication, checkpointGeneration }: PendingPublication): void {
    this.#revision = publication.revision;
    this.#acknowledgedGeneration = publication.publicationGeneration;
    this.#acceptedCheckpointGeneration = checkpointGeneration;
  }

  #assertMutable(): void {
    this.#assertActive();
    this.#handleState._assertEngineMutationAllowed();
  }

  #assertPublicationMutationAllowed(): void {
    this.#assertMutable();
    this.#transport.assertMutationAllowed();
  }

  #assertTextQueryable(state: RetainedTextState): void {
    this.#assertMutable();
    this.#ensureEngineRebuilt();
    if (state.disposed) throw new Error('text engine text has been disposed');
    if (state.measurement === undefined) {
      try {
        this.#prepareTextCandidate(state, true);
        this.#transport.acceptPreparedMutation();
      } catch (error) {
        this.#invalidateUnadoptedPreparation();
        throw error;
      }
    }
  }

  #invalidateUnadoptedPreparation(): void {
    if (this.#transport.invalidateUnadoptedMutation()) this.#engineNeedsRebuild = true;
  }

  #ensureEngineRebuilt(): void {
    if (!this.#engineNeedsRebuild) return;
    this.#transport.resetDerivedRoot();
    this.#engineRevision = 0;
    this.#revision = 0;
    this.#checkpointGeneration = checkedNextCheckpointGeneration(this.#checkpointGeneration);
    this.#preparationRemovals.clear();
    try {
      for (const state of this.#texts) {
        if (state.removed || state.disposed) continue;
        const replay: RetainedTextState = {
          ...state,
          prepared: false,
          preparedText: '',
          committedFlowRegions: new Map(),
          committedFlowExclusions: new Map(),
          pendingFlowRegions: new Map(),
          pendingFlowExclusions: new Map(),
          styleChanges: retainedStyleChanges(state.desired),
          geometryDirty: true,
        };
        this.#prepareTextCandidate(replay);
        state.prepared = true;
        state.preparedText = replay.preparedText;
        state.geometryRevision = replay.geometryRevision;
        state.committedFlowRegions = replay.committedFlowRegions;
        state.committedFlowExclusions = replay.committedFlowExclusions;
        state.pendingFlowRegions = replay.pendingFlowRegions;
        state.pendingFlowExclusions = replay.pendingFlowExclusions;
        state.measurement = replay.measurement;
        state.inspection = undefined;
        state.dirty = true;
        state.lifecycleDirty = true;
        state.geometryDirty = false;
        state.orderDirty = true;
        state.styleChanges = noRetainedStyleChanges;
        this.#pendingTexts.add(state);
        this.#transport.acceptPreparedMutation();
      }
      this.#transforms = undefined;
      this.#baseOrderValidationPending = true;
      this.#dirtyListener?.();
      this.#engineNeedsRebuild = false;
    } catch (error) {
      this.#engineNeedsRebuild = true;
      throw error;
    }
  }

  #isDirty(): boolean {
    return (
      this.#pendingTexts.size !== 0 ||
      this.#removed.size !== 0 ||
      this.#checkpointGeneration !== this.#acceptedCheckpointGeneration
    );
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
    const failure = this.#planner._updateText(this.#state, update);
    if (failure !== undefined) throw failure.error;
  }

  updateOrder(order: number, orderScope: number, orderRank: number): void {
    this.#planner._updateTextOrder(this.#state, order, orderScope, orderRank);
  }

  measure(): ParagraphLayoutSummary {
    return this.#planner._layoutText(this.#state);
  }

  measureInk(): ParagraphLayoutSummary {
    return this.#planner._layoutTextWithInk(this.#state);
  }

  glyphs(): GlyphLayoutInspection {
    return this.#planner._inspectText(this.#state);
  }

  readGlyphs<Result>(read: (glyphs: BorrowedGlyphLayout) => Result): Result {
    return this.#planner._readGlyphs(this.#state, read);
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

interface NormalizedPublishOptions {
  readonly semanticViewMask: number;
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
  return {
    semanticViewMask,
  };
}

function resolveTextOptions(
  handleState: GlyphHandleState,
  value: RetainedTextOptions,
  previous?: ResolvedTextOptions,
): ResolvedTextOptions {
  if (!isNonArrayObject(value)) throw new TypeError('text engine text options must be an object');
  validateTextScalarOptions(value);
  const previousInput = typeof previous?.source.text === 'object' ? previous.source.text : undefined;
  const formattedText = ownTextInput(value.text, previousInput);
  validateInlineObjects(value.inlineObjects, formattedText.text.length);
  const style =
    value.style === undefined ? {} : reuseOrCreateTextStyleSnapshot(previous?.source.style, value.style, 'text style');
  const layout = value.layout ?? {};
  const constraints = value.constraints ?? {};
  if (style !== previous?.source.style || formattedText.text.length !== previous.text.length) {
    assertTextStyleFeatureRanges(style, 0, formattedText.text.length, 'text style');
  }
  assertParagraphLayout(layout, 'text layout');
  assertConstraints(constraints, 'text constraints');
  normalizedColumns(layout, constraints);
  const materialLeases = new Map<HandleMaterialBinding, HandleBindingLease<HandleMaterialBinding>>();
  const font = handleState._retainFontStackBinding(value.font);
  const leases: Array<{ dispose(): void }> = [font];
  try {
    const retainMaterial = (binding: HandleMaterialBinding): HandleBindingLease<HandleMaterialBinding> => {
      let retained = materialLeases.get(binding);
      if (retained === undefined) {
        retained = handleState._retainOpaqueBinding(binding, 'material');
        materialLeases.set(binding, retained);
        leases.push(retained);
      }
      return retained;
    };
    assertTextEffectsSupported(style, font.formats, 'text engine text style');
    const material = value.material === undefined ? undefined : retainMaterial(value.material);
    const createdTransform = value.transform === undefined;
    const transformBinding = value.transform ?? handleState.createTransformBinding();
    const transform = handleState._retainOpaqueBinding(transformBinding, 'transform');
    leases.push(transform);
    if (createdTransform) transformBinding.dispose();
    const spans = formattedText.spans.map((span) => {
      const spanFont = span.font === undefined ? undefined : handleState._retainFontStackBinding(span.font);
      if (spanFont !== undefined) leases.push(spanFont);
      if (span.style !== undefined) {
        assertTextEffectsSupported(
          span.style,
          spanFont?.formats ?? font.formats,
          `text engine span [${span.start}, ${span.end}) style`,
        );
      }
      const spanMaterial = span.material === undefined ? undefined : retainMaterial(span.material);
      return Object.freeze({
        start: span.start,
        end: span.end,
        font: spanFont,
        material: spanMaterial,
        style: span.style,
      });
    });
    const flowTransforms: HandleBindingLease<HandleTransformBinding>[] = [];
    for (const flowRegion of value.flow?.regions ?? []) {
      const retained = handleState._retainOpaqueBinding(flowRegion.region.transform, 'transform');
      leases.push(retained);
      flowTransforms.push(retained);
    }
    const inlineMaterials: HandleBindingLease<HandleMaterialBinding>[] = [];
    const inlineResources: HandleBindingLease<HandleResourceBinding>[] = [];
    for (const object of value.inlineObjects ?? []) {
      const retainedMaterial = retainMaterial(object.material);
      inlineMaterials.push(retainedMaterial);
      const retainedResource = handleState._retainOpaqueBinding(object.resource, 'resource');
      leases.push(retainedResource);
      inlineResources.push(retainedResource);
    }
    return {
      source: snapshotTextOptions(
        value.style === undefined ? value : { ...value, style },
        formattedText,
        font,
        material,
        transform,
        flowTransforms,
        inlineMaterials,
        inlineResources,
        style,
        previous,
      ),
      ownership: { references: 1, leases },
      text: formattedText.text,
      spans: Object.freeze(spans),
      font,
      material,
      transform,
      flowTransforms: Object.freeze(flowTransforms),
      inlineMaterials: Object.freeze(inlineMaterials),
      inlineResources: Object.freeze(inlineResources),
    };
  } catch (error) {
    for (const lease of leases.reverse()) lease.dispose();
    throw error;
  }
}

function validateInlineObjects(
  objects: readonly RetainedTextInlineObjectInput[] | undefined,
  textLength: number,
): void {
  let previousOffset = -1;
  for (const [index, object] of (objects ?? []).entries()) {
    if (!Number.isSafeInteger(object.textOffset)) {
      throw new TypeError(`text inline object ${index} offset must be a safe integer`);
    }
    if (object.textOffset < 0 || object.textOffset > textLength) {
      throw new RangeError(`text inline object ${index} offset is outside the text`);
    }
    if (object.textOffset <= previousOffset) {
      throw new RangeError('text inline object offsets must be strictly increasing');
    }
    previousOffset = object.textOffset;
  }
}

function snapshotTextOptions(
  value: RetainedTextOptions,
  input: RetainedFormattedText,
  font: ReturnType<GlyphHandleState['_retainFontStackBinding']>,
  material: HandleBindingLease<HandleMaterialBinding> | undefined,
  transform: HandleBindingLease<HandleTransformBinding>,
  flowTransforms: readonly HandleBindingLease<HandleTransformBinding>[],
  inlineMaterials: readonly HandleBindingLease<HandleMaterialBinding>[],
  inlineResources: readonly HandleBindingLease<HandleResourceBinding>[],
  style: TextStyle,
  previous?: ResolvedTextOptions,
): RetainedTextOptions {
  return Object.freeze({
    font: font.binding,
    text: input,
    ...(material === undefined ? {} : { material: material.binding }),
    transform: transform.binding,
    ...(value.order === undefined ? {} : { order: value.order }),
    ...(value.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: value.rasterPixelRatio }),
    ...(value.style === undefined ? {} : { style }),
    ...(value.layout === undefined
      ? {}
      : { layout: reuseOrCreateTextPropertySnapshot(previous?.source.layout, value.layout, 'text layout') }),
    ...(value.constraints === undefined
      ? {}
      : {
          constraints: reuseOrCreateTextPropertySnapshot(
            previous?.source.constraints,
            value.constraints,
            'text constraints',
          ),
        }),
    ...(value.flow === undefined
      ? {}
      : {
          flow: Object.freeze({
            regions: Object.freeze(
              value.flow.regions.map((flowRegion, index) => {
                const { transform: _regionTransform, ...region } = flowRegion.region;
                return Object.freeze({
                  region: Object.freeze({
                    ...snapshotAuthoredData(region, `text flow region ${index}`),
                    transform: flowTransforms[index]!.binding,
                  }),
                  ...(flowRegion.exclusions === undefined
                    ? {}
                    : {
                        exclusions: Object.freeze(
                          snapshotAuthoredData(flowRegion.exclusions, `text flow region ${index} exclusions`),
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
                ...snapshotAuthoredData(data, `text inline object ${index}`),
                material: inlineMaterials[index]!.binding,
                resource: inlineResources[index]!.binding,
              });
            }),
          ),
        }),
  });
}

function validateTextScalarOptions(value: RetainedTextOptions): void {
  if (value.order !== undefined) uint32(value.order, 'text order');
  if (
    value.rasterPixelRatio !== undefined &&
    (!Number.isFinite(value.rasterPixelRatio) || value.rasterPixelRatio <= 0)
  ) {
    throw new RangeError('text rasterPixelRatio must be positive and finite');
  }
}

function mergeRetainedTextOptions(
  previous: RetainedTextOptions,
  order: number,
  update: RetainedTextUpdate,
): RetainedTextOptions {
  const merged = { ...previous, order, ...update };
  return Object.freeze({
    font: merged.font,
    text: merged.text,
    ...(merged.material === undefined ? {} : { material: merged.material }),
    ...(merged.transform === undefined ? {} : { transform: merged.transform }),
    ...(merged.order === undefined ? {} : { order: merged.order }),
    ...(merged.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: merged.rasterPixelRatio }),
    ...(merged.style === undefined ? {} : { style: merged.style }),
    ...(merged.layout === undefined ? {} : { layout: merged.layout }),
    ...(merged.constraints === undefined ? {} : { constraints: merged.constraints }),
    ...(merged.flow === undefined ? {} : { flow: merged.flow }),
    ...(merged.inlineObjects === undefined ? {} : { inlineObjects: merged.inlineObjects }),
  });
}

function textOnlyUpdate(update: RetainedTextUpdate, previous: ResolvedTextOptions): string | undefined {
  const keys = Reflect.ownKeys(update);
  if (keys.length !== 1 || keys[0] !== 'text' || typeof update.text !== 'string' || previous.spans.length !== 0) {
    return undefined;
  }
  validateInlineObjects(previous.source.inlineObjects, update.text.length);
  if (update.text.length !== previous.text.length) {
    assertTextStyleFeatureRanges(previous.source.style ?? {}, 0, update.text.length, 'text style');
  }
  return update.text;
}

function updateChangesStyle(
  update: RetainedTextUpdate,
  previous: ResolvedTextOptions,
  desired: ResolvedTextOptions,
): boolean {
  return (
    Object.hasOwn(update, 'font') ||
    Object.hasOwn(update, 'material') ||
    Object.hasOwn(update, 'rasterPixelRatio') ||
    Object.hasOwn(update, 'style') ||
    (Object.hasOwn(update, 'text') && (previous.spans.length !== 0 || desired.spans.length !== 0))
  );
}

function sameTextExceptAnchor(previous: ResolvedTextOptions, next: ResolvedTextOptions, ordinal: number): boolean {
  const beforeAnchor = previous.source.constraints?.anchor;
  const afterAnchor = next.source.constraints?.anchor;
  if (beforeAnchor === afterAnchor) return false;

  const left = previous.source;
  const right = next.source;
  return (
    previous.text === next.text &&
    previous.spans.length === next.spans.length &&
    previous.spans.every((span, index) => sameSpanEngineStyle(span, next.spans[index]!)) &&
    previous.font.handle === next.font.handle &&
    previous.material?.handle === next.material?.handle &&
    previous.transform.handle === next.transform.handle &&
    left.style === right.style &&
    left.layout === right.layout &&
    left.flow === right.flow &&
    left.inlineObjects === right.inlineObjects &&
    (left.order ?? ordinal - 1) === (right.order ?? ordinal - 1) &&
    left.rasterPixelRatio === right.rasterPixelRatio &&
    sameConstraintSizes(left.constraints, right.constraints)
  );
}

function forkResolvedTextWithText(previous: ResolvedTextOptions, text: string, order: number): ResolvedTextOptions {
  const value = {
    ...previous,
    source: Object.freeze({ ...previous.source, text, order }),
    text,
  };
  retainResolvedText(value);
  return value;
}

function retainedStyleChanges(
  desired: ResolvedTextOptions,
  committed?: ResolvedTextOptions,
): readonly RetainedStyleChange[] {
  const changes: RetainedStyleChange[] = [];
  if (committed === undefined || !sameRootEngineStyle(desired, committed)) changes.push({ kind: 'root' });

  let desiredIndex = nextNonEmptySpan(desired.spans, 0);
  let committedIndex = nextNonEmptySpan(committed?.spans ?? [], 0);
  let styleIndex = 2;
  while (desiredIndex !== -1 || committedIndex !== -1) {
    const desiredSpan = desiredIndex === -1 ? undefined : desired.spans[desiredIndex];
    const committedSpan = committedIndex === -1 ? undefined : committed!.spans[committedIndex];
    if (desiredSpan === undefined) {
      changes.push({ kind: 'remove', styleIndex });
    } else if (committedSpan === undefined || !sameSpanEngineStyle(desiredSpan, committedSpan)) {
      changes.push({ kind: 'span', styleIndex, cascadeOrder: styleIndex - 1, span: desiredSpan });
    }
    styleIndex += 1;
    desiredIndex = desiredIndex === -1 ? -1 : nextNonEmptySpan(desired.spans, desiredIndex + 1);
    committedIndex = committedIndex === -1 ? -1 : nextNonEmptySpan(committed!.spans, committedIndex + 1);
  }
  return changes.length === 0 ? noRetainedStyleChanges : Object.freeze(changes);
}

function nextNonEmptySpan(spans: readonly ResolvedSpan[], start: number): number {
  for (let index = start; index < spans.length; index += 1) {
    const span = spans[index]!;
    if (span.start !== span.end) return index;
  }
  return -1;
}

function sameRootEngineStyle(left: ResolvedTextOptions, right: ResolvedTextOptions): boolean {
  return (
    left.text.length === right.text.length &&
    left.source.style === right.source.style &&
    left.font.handle === right.font.handle &&
    left.material?.handle === right.material?.handle &&
    Object.is(left.source.rasterPixelRatio ?? 1, right.source.rasterPixelRatio ?? 1)
  );
}

function sameSpanEngineStyle(left: ResolvedSpan, right: ResolvedSpan): boolean {
  return (
    left.start === right.start &&
    left.end === right.end &&
    left.style === right.style &&
    left.font?.handle === right.font?.handle &&
    left.material?.handle === right.material?.handle
  );
}

function compileStyles(handleState: GlyphHandleState, state: RetainedTextState): readonly PlannerStyleMutation[] {
  if (state.styleChanges.length === 0) return EMPTY_REQUEST_ITEMS;
  const desired = state.desired;
  const source = desired.source;
  return state.styleChanges.map((change): PlannerStyleMutation => {
    const styleIndex = change.kind === 'root' ? 1 : change.styleIndex;
    const styleId = (state.styleIds[styleIndex] ??= engineStyleId(handleState.id, state.paragraphId, styleIndex));
    if (change.kind === 'remove') {
      return {
        opcode: 'remove',
        paragraphId: state.paragraphId,
        styleId,
      };
    }
    if (change.kind === 'root') {
      return {
        opcode: 'upsert',
        paragraphId: state.paragraphId,
        styleId,
        cascadeOrder: 0,
        start: 0,
        end: desired.text.length,
        root: true,
        value: engineStyleValue(source.style ?? {}, 0, desired.text.length, {
          fontStackHandle: desired.font.handle,
          fontSize: source.style?.fontSize ?? 16,
          rasterPixelRatio: source.rasterPixelRatio ?? 1,
          ...(desired.material === undefined ? {} : { materialId: desired.material.handle }),
        }),
      };
    }
    const span = change.span;
    return {
      opcode: 'upsert',
      paragraphId: state.paragraphId,
      styleId,
      cascadeOrder: change.cascadeOrder,
      start: span.start,
      end: span.end,
      value: engineStyleValue(span.style ?? {}, span.start, span.end, {
        ...(span.font === undefined ? {} : { fontStackHandle: span.font.handle }),
        ...(span.material === undefined ? {} : { materialId: span.material.handle }),
      }),
    };
  });
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

function pendingStyleMutationCount(state: RetainedTextLimitState): number {
  return state.styleChanges.length;
}

function compileGeometry(
  handleState: GlyphHandleState,
  state: RetainedTextState,
  regionStart: number,
  exclusionStart: number,
  revision = state.geometryRevision + 1,
): Readonly<{
  constraint: PlannerConstraint;
  regions: readonly PlannerRegion[];
  exclusions: readonly PlannerExclusion[];
}> {
  const ordinary = compileEngineGeometry(
    handleState.id,
    state.paragraphId,
    state.desired.transform.handle,
    revision,
    state.desired.source.layout,
    state.desired.source.constraints,
    regionStart,
  );
  const flow = state.desired.source.flow;
  const pendingRegions = state.pendingFlowRegions;
  const pendingExclusions = state.pendingFlowExclusions;
  pendingRegions.clear();
  pendingExclusions.clear();
  if (flow === undefined) return { ...ordinary, exclusions: [] };
  const regions: PlannerRegion[] = [];
  const exclusions: PlannerExclusion[] = [];
  for (const [regionIndex, input] of flow.regions.entries()) {
    const transform = state.desired.flowTransforms[regionIndex]!;
    const firstExclusion = exclusionStart + exclusions.length;
    const { key: regionKey, ...region } = input.region;
    const regionId = handleState.id('region', keyedFlowIdentity(state.paragraphId, 'region', regionKey));
    const committedRegion = state.committedFlowRegions.get(regionKey);
    const regionRevision =
      committedRegion !== undefined &&
      committedRegion.transformHandle === transform.handle &&
      sameFlowRegion(committedRegion.input, input.region)
        ? committedRegion.revision
        : revision;
    regions.push({
      ...region,
      id: regionId,
      geometryRevision: regionRevision,
      transformIndex: transform.handle,
      exclusionStart: firstExclusion,
      exclusionCount: input.exclusions?.length ?? 0,
    });
    pendingRegions.set(regionKey, {
      input: input.region,
      transformHandle: transform.handle,
      revision: regionRevision,
    });
    for (const exclusion of input.exclusions ?? []) {
      const { key: exclusionKey, ...record } = exclusion;
      const entityKey = flowExclusionIdentity(regionKey, exclusionKey);
      const committedExclusion = state.committedFlowExclusions.get(entityKey);
      const exclusionRevision =
        committedExclusion !== undefined && sameFlowExclusion(committedExclusion.input, exclusion)
          ? committedExclusion.revision
          : revision;
      exclusions.push({
        ...record,
        id: handleState.id('exclusion', keyedFlowIdentity(state.paragraphId, 'exclusion', regionKey, exclusionKey)),
        regionId,
        geometryRevision: exclusionRevision,
      });
      pendingExclusions.set(entityKey, { input: exclusion, revision: exclusionRevision });
    }
  }
  return {
    constraint: { ...ordinary.constraint, regionStart, regionCount: regions.length },
    regions,
    exclusions,
  };
}

function commitFlowEntityRevisions(state: RetainedTextState): void {
  const regions = state.pendingFlowRegions;
  const exclusions = state.pendingFlowExclusions;
  [state.committedFlowRegions, state.pendingFlowRegions] = [regions, state.committedFlowRegions];
  [state.committedFlowExclusions, state.pendingFlowExclusions] = [exclusions, state.committedFlowExclusions];
}

function sameFlowRegion(left: RetainedTextRegionInput, right: RetainedTextRegionInput): boolean {
  return (
    left.shape === right.shape &&
    left.writingMode === right.writingMode &&
    left.textOrientation === right.textOrientation &&
    Object.is(left.inlineStart, right.inlineStart) &&
    Object.is(left.blockStart, right.blockStart) &&
    Object.is(left.inlineEnd, right.inlineEnd) &&
    Object.is(left.blockEnd, right.blockEnd) &&
    Object.is(left.clipInlineStart, right.clipInlineStart) &&
    Object.is(left.clipBlockStart, right.clipBlockStart) &&
    Object.is(left.clipInlineEnd, right.clipInlineEnd) &&
    Object.is(left.clipBlockEnd, right.clipBlockEnd) &&
    sameFlowVertices(left.vertices, right.vertices)
  );
}

function sameFlowExclusion(left: RetainedTextExclusionInput, right: RetainedTextExclusionInput): boolean {
  return (
    left.shape === right.shape &&
    left.wrapSide === right.wrapSide &&
    Object.is(left.inlineStart, right.inlineStart) &&
    Object.is(left.blockStart, right.blockStart) &&
    Object.is(left.inlineEnd, right.inlineEnd) &&
    Object.is(left.blockEnd, right.blockEnd) &&
    Object.is(left.marginInline, right.marginInline) &&
    Object.is(left.marginBlock, right.marginBlock) &&
    sameFlowVertices(left.vertices, right.vertices)
  );
}

function sameFlowVertices(
  left: readonly { readonly inline: number; readonly block: number }[] | undefined,
  right: readonly { readonly inline: number; readonly block: number }[] | undefined,
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined || left.length !== right.length) return false;
  return left.every(
    (vertex, index) => Object.is(vertex.inline, right[index]!.inline) && Object.is(vertex.block, right[index]!.block),
  );
}

function keyedFlowIdentity(
  paragraphId: number,
  kind: 'region' | 'exclusion',
  regionKey: string,
  exclusionKey?: string,
): string {
  const region = `${regionKey.length}:${regionKey}`;
  return exclusionKey === undefined
    ? `paragraph/${paragraphId}/flow/${kind}/${region}`
    : `paragraph/${paragraphId}/flow/${kind}/${region}/${exclusionKey.length}:${exclusionKey}`;
}

function flowExclusionIdentity(regionKey: string, exclusionKey: string): string {
  return `${regionKey.length}:${regionKey}/${exclusionKey.length}:${exclusionKey}`;
}

function compileInlineObjects(
  handleState: GlyphHandleState,
  state: RetainedTextState,
  contentRevision = state.geometryRevision + 1,
): readonly PlannerInlineObject[] {
  return (state.desired.source.inlineObjects ?? []).map((object, index) => ({
    ...object,
    paragraphId: state.paragraphId,
    id: handleState.id('inline-object', `paragraph/${state.paragraphId}/inline/${index}`),
    contentRevision,
    materialId: state.desired.inlineMaterials[index]!.handle,
    resourceId: state.desired.inlineResources[index]!.handle,
    resourceGeneration: 1,
  }));
}

interface ResolvedTextOwnership {
  references: number;
  readonly leases: readonly { dispose(): void }[];
}

function retainResolvedText(value: ResolvedTextOptions): void {
  value.ownership.references += 1;
}

function releaseResolvedText(value: ResolvedTextOptions): void {
  const ownership = value.ownership;
  ownership.references -= 1;
  if (ownership.references !== 0) return;
  let failure: unknown;
  for (const lease of [...ownership.leases].reverse()) {
    try {
      lease.dispose();
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== undefined) throw failure;
}

function assertRenderPlannerOptions(value: unknown): asserts value is RenderPlannerOptions {
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

function assertTarget(value: unknown): asserts value is PlanTarget {
  if (!isNonArrayObject(value)) throw new TypeError('plan target factory must return an object');
  if (value.delivery !== 'borrowed') throw new TypeError('plan target delivery must be borrowed');
  if (typeof value.accept !== 'function' || typeof value.dispose !== 'function') {
    throw new TypeError('plan target must implement accept() and dispose()');
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

function checkedNextOrdinal(value: number): number {
  if (value >= MAX_U32) throw new RangeError('text handles are exhausted');
  return value + 1;
}

function requirePreparedMeasurement(state: RetainedTextState): ParagraphLayoutSummary {
  if (!state.prepared || state.measurement === undefined) {
    throw new Error('retained text has no current prepared measurement');
  }
  return state.measurement;
}

function checkedNextCheckpointGeneration(value: number): number {
  if (value >= MAX_U32) throw new RangeError('plan target checkpoint generation is exhausted');
  return value + 1;
}

function publicationIsCheckpoint(publication: PlanPublication): boolean {
  return (publication.flags & textShaperAbi.engine.resultFlags.checkpoint) !== 0;
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

/** Snapshots plain authored values at publication; Font and resource ownership never enters this path. */
function snapshotAuthoredData<Value>(value: Value, label: string): Value {
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
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  );
}
