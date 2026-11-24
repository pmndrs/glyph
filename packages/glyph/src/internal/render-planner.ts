import { sameConstraintSizes, withTextAnchor } from '../text-anchor.js';
import { textShaperAbi } from '../generated/text-shaper-abi.js';
import { GlyphError, GlyphLayoutPhaseError } from '../glyph-error.js';
import { GlyphEngineStatusError, glyphEngineStatusErrorDetails } from '../engine-error.js';
import { GlyphEngineRestartError } from './text-shaper-module.js';
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
  type PlannerParagraphOrderMutation,
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
  readPlannerGlyphFacts,
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
import {
  createHandleIdFactory,
  GlyphIdScope,
  type HandleIdFactory,
  type ParagraphId,
  type ResourceHandle,
  type StyleId,
} from './glyph-id.js';
import { codecCapabilitySetSelectionId, selectCodecCapabilitySet } from './codec-capability-selection.js';
import { ownTextInput } from '../config/text-span-owner.js';
import {
  changesLayoutStyle,
  LAYOUT_PHASE_WRITE_MESSAGE,
  minimalTextReplacement,
  statedTextReplacement,
  type TextRangeReplacement,
} from '../text-mutation.js';
import type { TextQuery } from './text-queries.js';
import { deferredGlyphFacts, glyphFactsOf, type DeferredGlyphFacts, type GlyphFacts } from './deferred-glyph-facts.js';

const MAX_U32 = 0xffff_ffff;
/**
 * A paragraph costs on the order of a kilobyte of engine memory per UTF-16 unit once shaped, laid out and
 * published. This bound keeps one text under roughly a hundred megabytes on any device.
 */
const DEFAULT_MAX_TEXT_UNITS = 65_536;
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
  /** The error that refused this text's last preparation, until its input changes; `undefined` otherwise. */
  readonly refusal: unknown;
  /**
   * Whether every batch preparation returns this text's summary. A text with a layout callback sets it, so its
   * callback reads the new layout without entering the engine again.
   */
  keepMeasured: boolean;
  /** The current summary if the last preparation returned one; never prepares and never enters the engine. */
  preparedMeasurement(): ParagraphLayoutSummary | undefined;
  readonly awaitsPreparation: boolean;
  update(update: RetainedTextUpdate): void;
  /** Repositions this paragraph without invalidating its semantic or measured state. */
  updateOrder(order: number, orderScope: number, orderRank: number): void;
  /** Returns aggregate metrics for the current desired state, preparing this paragraph first when it is dirty. */
  measure(): ParagraphLayoutSummary;
  /** Returns aggregate metrics with authoritative positioned ink bounds. */
  measureInk(): ParagraphLayoutSummary;
  /** Copies caller-owned columns from the latest prepared positioned glyphs. */
  glyphs(): GlyphLayoutInspection;
  /** Demand-reads positioned glyphs through a synchronous expiring view. */
  readGlyphs<Result>(read: (glyphs: BorrowedGlyphLayout) => Result): Result;
  /** Runs one editing query over the current desired state, preparing this paragraph first when it is dirty. */
  textQuery<Result>(query: TextQuery<Result>): Result;
  /** States the exact range the next text value replaces, so the engine is told that range and not a compared one. */
  stateReplacement(replacement: TextRangeReplacement): void;
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
  /** The most UTF-16 units one text may hold; a setter beyond it throws. Defaults to 65,536. */
  readonly maxTextUnits?: number;
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
class RenderPlannerDisposedError extends GlyphError<'engine-failed'> {
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
  /** The canonical columns with their non-enumerable outline read, as an integration consumes them. */
  readonly columns: GlyphLayoutInspection;
  /** The same lanes as plain data: copying from an all-enumerable record stays on the engine's fast clone path. */
  readonly source: GlyphLayoutColumns;
}

/** @internal Canonical inspection columns for an integration's synchronous derived query. */
export interface OwnedTextInspectionView {
  readonly columns: GlyphLayoutInspection;
  readonly readyToDraw: boolean;
}

type TextInspection = OwnedTextInspection | { readonly kind: 'borrowed'; recordReads: number };

interface RetainedTextState {
  /** Every ID this text minted, released together when the text retires so the registry holds only live texts. */
  readonly idScope: GlyphIdScope;
  /** Mints into `idScope`; built on the first compile, since a text disposed before it is prepared needs none. */
  ids: HandleIdFactory | undefined;
  readonly paragraphId: ParagraphId;
  readonly ordinal: number;
  readonly styleIds: StyleId[];
  desired: ResolvedTextOptions;
  metrics: RetainedTextMetrics;
  /**
   * The desired state the engine last prepared, leased until a later preparation replaces it. Every
   * mutation is derived against it, so values overwritten before a preparation never reach the engine.
   */
  preparedDesired: ResolvedTextOptions | undefined;
  preparedOrder: number;
  /**
   * Whether the engine holds this paragraph. The first read of a root creates every paragraph it has not seen
   * in that one request, so the lifecycle work of a mount is paid once and not once per read.
   */
  created: boolean;
  prepared: boolean;
  /** The range the last `replace()` named, used when it still takes the prepared text to the desired one. */
  statedReplacement?: TextRangeReplacement;
  /**
   * The error of a preparation the engine refused for this paragraph alone. The engine emptied the paragraph, so
   * it is restated from nothing once its input changes; until then it is left out of every batch.
   */
  refusal: unknown;
  /** Set by an owner that reads every new summary, such as a layout callback. */
  keepMeasured: boolean;
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
  /** Whether a caller read the current measurement; only then does the next setter keep one current. */
  measurementRead: boolean;
  inspection: TextInspection | undefined;
  /**
   * The glyph facts a summary-only read left to compute on first read. They answer for the preparation that read
   * adopted, so they are resolved before the engine prepares or removes this paragraph again.
   */
  deferredFacts: DeferredGlyphFacts | undefined;
  /**
   * The glyph facts of the last summary a measurement handed out, deferred or not. When its caller read them, the
   * next read asks for glyph facts up front instead of leaving them for a second engine call.
   */
  observedFacts: DeferredGlyphFacts | undefined;
  /**
   * Deferred glyph facts whose preparation an engine restart discarded, with the desired state they measured,
   * leased until they are re-derived. They are re-derived before this paragraph is prepared again.
   */
  orphanedFacts: OrphanedGlyphFacts | undefined;
}

interface OrphanedGlyphFacts {
  readonly facts: DeferredGlyphFacts;
  readonly measured: ResolvedTextOptions;
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

interface RetainedTextLimitState {
  readonly desired: ResolvedTextOptions;
  readonly metrics: RetainedTextMetrics;
  readonly styleChanges: readonly RetainedStyleChange[];
}

/** One paragraph's share of a preparation request, derived against what the engine last prepared. */
interface ParagraphPreparation {
  readonly state: RetainedTextState;
  readonly text: PlannerTextMutation | undefined;
  readonly styles: readonly PlannerStyleMutation[];
  readonly geometryChanged: boolean;
  readonly geometryRevision: number;
  /** Whether the engine has anything to do for this paragraph beyond answering a measurement. */
  readonly changed: boolean;
}

/** The records one shared preparation request accumulates, in ascending paragraph order. */
interface PreparationRecords {
  readonly upserts: PlannerParagraphMutation[];
  readonly textMutations: PlannerTextMutation[];
  readonly styleMutations: PlannerStyleMutation[];
  readonly constraints: PlannerConstraint[];
  readonly regions: PlannerRegion[];
  readonly exclusions: PlannerExclusion[];
  readonly inlineObjects: PlannerInlineObject[];
  readonly paragraphs: ParagraphPreparation[];
  /** Paragraphs whose summary is serialized when the request does not measure all of them. */
  readonly measured: number[];
  /** Paragraphs whose deferred glyph facts the request answers before applying their input. */
  readonly prior: number[];
}

function emptyPreparationRecords(): PreparationRecords {
  return {
    upserts: [],
    textMutations: [],
    styleMutations: [],
    constraints: [],
    regions: [],
    exclusions: [],
    inlineObjects: [],
    paragraphs: [],
    measured: [],
    prior: [],
  };
}

interface StagedPreparation {
  readonly paragraphs: readonly ParagraphPreparation[];
  readonly removals: readonly RetainedTextState[];
  readonly includeMeasurement: boolean;
  readonly prior: readonly number[];
}

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
  /** The publication returns the glyph facts deferred summaries still owe. */
  readonly glyphFacts: boolean;
}

/** @internal A request written into one root's arena, waiting for an engine-wide batch call. */
export interface StagedPlannerRequest {
  readonly rootId: number;
  readonly requestLength: number;
}

/** @internal One root's dirty paragraphs staged for the engine-wide batch preparation. */
export interface StagedPlannerPreparation extends StagedPlannerRequest {
  adoptPreparation(resultPointer: number, memoryBuffer: ArrayBuffer): void;
  discardPreparation(): void;
}

/** @internal One retained synchronous planner staged for the engine-wide shape batch. */
export interface StagedRenderPlanner extends StagedPlannerRequest {
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

/** @internal Refuses a text longer than one paragraph may be; the same check every setter of every layer applies. */
export function assertTextUnitLimit(text: string, maxTextUnits: number = DEFAULT_MAX_TEXT_UNITS): void {
  if (text.length > maxTextUnits) {
    throw new RangeError(
      `text holds ${String(text.length)} UTF-16 units; one text accepts at most ${String(maxTextUnits)} (commands.maxTextUnits)`,
    );
  }
}

/** @internal Tells a planner that a trap replaced the engine instance and its root was created again, empty. */
export function restartRenderPlanner(planner: RenderPlanner): void {
  if (!(planner instanceof RenderPlannerImpl)) throw new TypeError('render planner was not created by this package');
  planner._engineRestarted();
}

/** @internal Stage every dirty paragraph of one root for batch preparation without crossing into Wasm. */
export function stageRenderPlannerPreparation(
  planner: RenderPlanner,
  measureAll: boolean,
  holdObserved = false,
): StagedPlannerPreparation | undefined {
  if (!(planner instanceof RenderPlannerImpl)) throw new TypeError('render planner was not created by this package');
  return planner._stagePreparation(measureAll, holdObserved);
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
  readonly #maxTextUnits: number;
  /** Automatic retries spent on a failed frame since the last success; one frame retries, then a change must. */
  #automaticRetries = 0;
  /** Set by an engine restart: the next preparation gives each paragraph its own request. */
  #isolateNextPreparation = false;
  readonly #texts = new Set<RetainedTextState>();
  /** Texts whose last adopted summary may still owe glyph facts; pruned when they are answered. */
  readonly #deferredFactTexts = new Set<RetainedTextState>();
  /** Owners whose renderer publication is behind their desired state. */
  readonly #pendingTexts = new Set<RetainedTextState>();
  /** Owners whose desired state the engine has not prepared: a setter adds, a read or the batch removes. */
  readonly #unprepared = new Set<RetainedTextState>();
  /** Paragraphs left out of the engine after a publication that could not hold them, with the error each reports. */
  readonly #withheld = new WeakMap<RetainedTextState, unknown>();
  #stagedPreparation: StagedPreparation | undefined;
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
    const maxTextUnits = (options as RenderPlannerOptions).maxTextUnits ?? DEFAULT_MAX_TEXT_UNITS;
    positiveU32(maxTextUnits, 'maxTextUnits');
    this.#maxTextUnits = maxTextUnits;
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
    try {
      this.#assertTextUnits(desired.text);
    } catch (error) {
      releaseResolvedText(desired);
      throw error;
    }
    const idScope = new GlyphIdScope();
    const paragraphId = idScope.id('paragraph', `${this.#handleState.integration}/text/${ordinal}`);
    const state: RetainedTextState = {
      idScope,
      ids: undefined,
      paragraphId,
      ordinal,
      styleIds: [],
      desired,
      metrics: retainedTextMetrics(desired, ordinal),
      preparedDesired: undefined,
      preparedOrder: 0,
      created: false,
      prepared: false,
      refusal: undefined,
      keepMeasured: false,
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
      measurementRead: false,
      inspection: undefined,
      deferredFacts: undefined,
      orphanedFacts: undefined,
      observedFacts: undefined,
    };
    try {
      state.preparedOrder = this.#preparationOrderForCreation(state.metrics.order);
      this.#validateAggregateLimits({
        desired,
        metrics: state.metrics,
        styleChanges: retainedStyleChanges(desired),
      });
    } catch (error) {
      idScope.dispose();
      releaseResolvedText(desired);
      throw error;
    }
    const previousBaseOrderValidationPending = this.#baseOrderValidationPending;
    // The first preparation installs the paragraph at its preparation order; publication restates it only when
    // another live paragraph still holds the desired one.
    state.lifecycleDirty = state.preparedOrder !== state.metrics.order;
    const text = new RetainedTextImpl(this, state);
    textStates.set(text, { planner: this, state });
    this.#claimPreparedOrder(state);
    this.#addLiveState(state);
    this.#texts.add(state);
    this.#transforms = undefined;
    this.#pendingTexts.add(state);
    this.#unprepared.add(state);
    this.#baseOrderValidationPending = true;
    this.#nextTextOrdinal = nextOrdinal;
    try {
      this.#dirtyListener?.();
    } catch (error) {
      this.#texts.delete(state);
      this.#unprepared.delete(state);
      this.#removeLiveState(state);
      this.#releasePreparedOrder(state);
      textStates.delete(text);
      state.disposed = true;
      state.desiredReleased = true;
      idScope.dispose();
      releaseResolvedText(desired);
      this.#nextTextOrdinal = ordinal;
      this.#baseOrderValidationPending = previousBaseOrderValidationPending;
      throw new Error('text creation failed while notifying its root; the text was discarded', { cause: error });
    }
    return text;
  }

  /**
   * @internal Validates an update and records it as the desired state. The engine is not entered: the next read
   * of this text, or the next batch preparation, derives one mutation against what the engine last prepared.
   */
  _updateText(state: RetainedTextState, update: RetainedTextUpdate): { error: unknown } | undefined {
    this.#assertPublicationMutationAllowed();
    if (state.disposed) throw new Error('text engine text has been disposed');
    if (!isNonArrayObject(update)) throw new TypeError('text engine text update must be an object');
    const textOnly = textOnlyUpdate(update, state.desired);
    if (textOnly !== undefined && textOnly === state.desired.text) return;
    if (textOnly !== undefined) this.#assertTextUnits(textOnly);
    const desired =
      textOnly === undefined
        ? resolveTextOptions(
            this.#handleState,
            mergeRetainedTextOptions(state.desired.source, state.metrics.order, update),
            state.desired,
          )
        : forkResolvedTextWithText(state.desired, textOnly, state.metrics.order);
    try {
      if (textOnly === undefined) this.#assertTextUnits(desired.text);
      if (this.#handleState._layoutPhaseActive() && changesLayoutInput(state.desired, desired)) {
        throw new GlyphLayoutPhaseError(LAYOUT_PHASE_WRITE_MESSAGE);
      }
    } catch (error) {
      releaseResolvedText(desired);
      throw error;
    }
    // After renderer rejection, even an anchor edit must retry the engine's unaccepted output.
    if (
      state.refusal === undefined &&
      !this.#isDirty() &&
      !this.#engineNeedsRebuild &&
      state.published &&
      state.committed === state.desired &&
      this.#engineRevision === this.#revision &&
      sameTextExceptAnchor(state.desired, desired, state.ordinal)
    ) {
      return this.#adoptAnchorOnlyUpdate(state, desired);
    }
    const metrics = retainedTextMetrics(desired, state.ordinal);
    const prepared = state.prepared ? state.preparedDesired : undefined;
    try {
      this.#validateAggregateLimits({ desired, metrics, styleChanges: retainedStyleChanges(desired, prepared) }, state);
    } catch (error) {
      releaseResolvedText(desired);
      throw error;
    }
    const previousDesired = state.desired;
    const previousOrder = state.metrics.order;
    const nextOrder = metrics.order;
    // A value the engine already prepared needs no preparation; one the renderer already draws needs no
    // publication either. Restoring a value before anything consumed the detour therefore costs nothing.
    const restoresPrepared = prepared !== undefined && sameEngineInput(desired, prepared, state.ordinal);
    const next = restoresPrepared ? prepared : desired;
    if (restoresPrepared) {
      retainResolvedText(prepared);
      releaseResolvedText(desired);
    }
    const transformsChanged =
      next.transform.handle !== previousDesired.transform.handle ||
      next.flowTransforms.length !== previousDesired.flowTransforms.length ||
      next.flowTransforms.some(
        (transform, index) => transform.handle !== previousDesired.flowTransforms[index]!.handle,
      );
    this.#replaceLiveState(state, metrics);
    state.desired = next;
    state.metrics = metrics;
    if (transformsChanged) this.#transforms = undefined;
    state.lifecycleDirty ||= previousOrder !== nextOrder;
    if (previousOrder !== nextOrder) this.#baseOrderValidationPending = true;
    if (restoresPrepared) {
      this.#unprepared.delete(state);
      state.geometryDirty = false;
    } else {
      // New input is a new chance: a refused paragraph is restated from nothing by the next preparation.
      state.refusal = undefined;
      this.#withheld.delete(state);
      this.#unprepared.add(state);
      state.geometryDirty ||= updateChangesGeometry(update, previousDesired, next);
    }
    if (restoresPrepared && state.published && state.committed === next && !state.lifecycleDirty && !state.orderDirty) {
      state.dirty = false;
      this.#pendingTexts.delete(state);
    } else {
      state.dirty = true;
      this.#pendingTexts.add(state);
    }
    return this.#finishAcceptedUpdate([previousDesired], 'text update was accepted, but a post-commit step failed');
  }

  /**
   * Releases the leases an accepted update replaced and notifies the root. Both follow acceptance, so each is
   * attempted before the first failure is reported as a post-commit error.
   */
  #finishAcceptedUpdate(released: readonly ResolvedTextOptions[], message: string): { error: unknown } | undefined {
    let postCommitError: unknown;
    let postCommitFailed = false;
    const attempt = (step: () => void): void => {
      try {
        step();
      } catch (error) {
        if (!postCommitFailed) postCommitError = error;
        postCommitFailed = true;
      }
    };
    for (const resolved of released) attempt(() => releaseResolvedText(resolved));
    attempt(() => this.#dirtyListener?.());
    return postCommitFailed ? { error: new PostCommitError(message, postCommitError) } : undefined;
  }

  #assertTextUnits(text: string): void {
    assertTextUnitLimit(text, this.#maxTextUnits);
  }

  /** Re-anchors an accepted, published paragraph whose layout input is otherwise unchanged; nothing is prepared. */
  #adoptAnchorOnlyUpdate(state: RetainedTextState, desired: ResolvedTextOptions): { error: unknown } | undefined {
    const anchor = desired.source.constraints?.anchor;
    let measurement: ParagraphLayoutSummary | undefined;
    let inspection: TextInspection | undefined;
    try {
      measurement = state.measurement === undefined ? undefined : withTextAnchor(state.measurement, anchor);
      inspection =
        state.inspection?.kind === 'owned'
          ? this.#ownedInspection(withTextAnchor(state.inspection.source, anchor))
          : state.inspection;
    } catch (error) {
      releaseResolvedText(desired);
      throw error;
    }
    const previous = [state.desired, state.committed!];
    // The accepted geometry and bindings are unchanged; own the new semantic identity for every
    // reference before any old lease can be released.
    retainResolvedText(desired);
    state.desired = desired;
    state.committed = desired;
    if (state.preparedDesired !== undefined) {
      previous.push(state.preparedDesired);
      retainResolvedText(desired);
      state.preparedDesired = desired;
    }
    state.measurement = measurement;
    state.inspection = inspection;
    return this.#finishAcceptedUpdate(previous, 'text anchor update was accepted, but a post-commit step failed');
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

  /** @internal The summary the last preparation returned, if this text is prepared and it returned one. */
  /** @internal */
  _awaitsPreparation(state: RetainedTextState): boolean {
    return this.#unprepared.has(state);
  }

  /** @internal */
  _preparedMeasurement(state: RetainedTextState): ParagraphLayoutSummary | undefined {
    if (state.disposed || !state.prepared || this.#unprepared.has(state)) return undefined;
    // A text whose owner began listening after it was prepared has no summary yet: it is read once, here.
    return state.measurement ?? this._layoutText(state);
  }

  /** @internal */
  _layoutText(state: RetainedTextState): ParagraphLayoutSummary {
    this.#assertTextQueryable(state);
    return requirePreparedMeasurement(state);
  }

  /** @internal Resolves positioned ink only when a host explicitly asks for it. */
  _layoutTextWithInk(state: RetainedTextState): ParagraphLayoutSummary {
    this.#assertTextQueryable(state, true);
    const measurement = requirePreparedMeasurement(state);
    if (measurement.inkBounds !== undefined || measurement.glyphCount === 0) return measurement;
    const inspection = this._ownedInspection(state);
    state.measurement = measurementFromLayoutInspection(inspection.columns);
    return state.measurement;
  }

  /** @internal */
  _inspectText(state: RetainedTextState): GlyphLayoutInspection {
    const inspection = this.#currentOwnedInspection(state);
    return copyGlyphLayoutInspection(inspection.source, inspection.columns.outlineAt);
  }

  /** @internal Gives Three the canonical private columns plus the current renderer-readiness fact. */
  _ownedInspection(state: RetainedTextState): OwnedTextInspectionView {
    const inspection = this.#currentOwnedInspection(state);
    return {
      columns: inspection.columns,
      readyToDraw:
        state.published &&
        state.committed === state.desired &&
        this.#checkpointGeneration === this.#acceptedCheckpointGeneration,
    };
  }

  #currentOwnedInspection(state: RetainedTextState): OwnedTextInspection {
    // The inspection copies the summary's line spans: they are resolved before the borrow, which a Wasm call expires.
    this.#assertTextQueryable(state, true);
    return state.inspection?.kind === 'owned'
      ? state.inspection
      : this.#ownInspection(state, this.#transport.borrowParagraphLayout(state.paragraphId));
  }

  #ownedInspection(layout: GlyphLayoutColumns): OwnedTextInspection {
    // Copies share font stores so their outlines outlive the source handle.
    const stores = new Map<number, GlyphOutlineStore | undefined>();
    for (const fontHandle of layout.fontHandles)
      stores.set(fontHandle, this.#handleState._glyphOutlineStore(fontHandle));
    const outlineAt: GlyphLayoutInspection['outlineAt'] = (index) =>
      storedGlyphOutline(
        requireGlyphOutlineStore(stores.get(fontHandleAt(layout, index))),
        layout.glyphIds[index]!,
      ).slice();
    const columns = { ...layout, outlineAt };
    Object.defineProperty(columns, 'outlineAt', { enumerable: false });
    return { kind: 'owned', columns: Object.freeze(columns), source: layout };
  }

  #ownInspection(state: RetainedTextState, publication: BorrowedLayoutPublication): OwnedTextInspection {
    if (state.inspection?.kind === 'owned') return state.inspection;
    const inspection = this.#ownedInspection(
      withTextAnchor(
        copyPreparedLayoutInspection(requirePreparedMeasurement(state), this.#transport, publication),
        state.desired.source.constraints?.anchor,
      ),
    );
    state.inspection = inspection;
    return inspection;
  }

  /** @internal Runs one editing query over this paragraph, prepared first as any read prepares it. */
  _textQuery<Result>(state: RetainedTextState, query: TextQuery<Result>): Result {
    this.#assertTextQueryable(state);
    return this.#transport.textQuery((exports, root) => query(exports, root, state.paragraphId));
  }

  /** @internal */
  _readGlyphs<Result>(state: RetainedTextState, read: (glyphs: BorrowedGlyphLayout) => Result): Result {
    this.#assertTextQueryable(state, true);
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
    this.#settleOrphanedFacts(state);
    this.#settleGlyphFacts(state);
    state.disposed = true;
    state.styleIds.length = 0;
    this.#transforms = undefined;
    this.#removeLiveState(state);
    this.#unprepared.delete(state);
    if (!state.created) {
      // The engine never saw this paragraph, so there is nothing to remove from it or from the renderer.
      this.#texts.delete(state);
      this.#releasePreparedOrder(state);
      state.removed = true;
      state.desiredReleased = true;
      releaseResolvedText(state.desired);
      state.idScope.dispose();
      this.#dirtyListener?.();
      return;
    }
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
    if (this.#stagedBatch !== undefined || this.#stagedPreparation !== undefined) {
      throw new Error('render planner is already staged');
    }
    // A paragraph is published only at a revision whose layout phase completed. One that became dirty after
    // this frame's preparation is held: the renderer keeps what it draws and the next frame prepares it.
    if (!force && !this.#hasPublishableChange()) return undefined;
    for (const removed of this.#preparationRemovals) this.#settleGlyphFacts(removed);
    const checkpointGeneration = this.#checkpointGeneration;
    // Publication positions every paragraph a read left owed. While an adopted summary still owes glyph facts, the
    // publication returns them, so a later read of those facts costs no crossing per paragraph.
    const glyphFacts = this.#glyphFactsWanted();
    const semanticViewMask =
      options.semanticViewMask | (glyphFacts ? textShaperAbi.engine.semanticViewMasks.glyphFacts : 0);
    const frame = this.#compileFrame({ ...options, semanticViewMask }, checkpointGeneration);
    this.#stagedRequestLength = this.#transport.stageUpdate(frame);
    this.#stagedBatch = { checkpointGeneration, semanticViewMask: options.semanticViewMask, glyphFacts };
    return this;
  }

  get rootId(): number {
    this.#assertStaged();
    return this.#transport.handle;
  }

  get requestLength(): number {
    this.#assertStaged();
    return this.#stagedRequestLength;
  }

  #assertStaged(): void {
    if (this.#stagedBatch === undefined && this.#stagedPreparation === undefined) {
      throw new Error('render planner is not staged');
    }
  }

  /**
   * @internal Writes one request that prepares every dirty paragraph of this root, without entering the engine.
   * Returns `undefined` when a read already prepared everything. `measureAll` also returns every prepared
   * paragraph's summary, for a caller about to read them.
   */
  _stagePreparation(measureAll: boolean, holdObserved = false): StagedPlannerPreparation | undefined {
    this.#assertMutable();
    this.#ensureEngineRebuilt();
    if (this.#stagedBatch !== undefined || this.#stagedPreparation !== undefined) {
      throw new Error('render planner is already staged');
    }
    if (this.#unprepared.size === 0) return undefined;
    // Orphaned glyph facts are re-derived by their own requests, before this one is collected.
    for (const state of [...this.#unprepared]) this.#settleOrphanedFacts(state);
    if (this.#isolateNextPreparation) {
      this.#prepareIsolated(measureAll);
      return undefined;
    }
    // The engine routes records by ascending paragraph identity.
    const states = [...this.#unprepared]
      .filter((state) => !holdObserved || !heldForObservedLayout(state))
      .sort((left, right) => left.paragraphId - right.paragraphId);
    if (states.length === 0) return undefined;
    for (const removed of this.#preparationRemovals) this.#settleGlyphFacts(removed);
    const records = emptyPreparationRecords();
    for (const state of states) this.#collectPreparation(records, state, measureAll);
    if (records.paragraphs.length === 0) return undefined;
    this.#stagePreparationRequest(records, measureAll);
    return this;
  }

  /** Adds one dirty paragraph's records to the shared request, or prepares it on its own when it cannot share one. */
  #collectPreparation(records: PreparationRecords, state: RetainedTextState, measureAll: boolean): void {
    const preparation = this.#paragraphPreparation(state);
    if (!preparation.changed) {
      // Setters cancelled out against the prepared value in a way only the derived mutation shows.
      this.#markPrepared(state);
      return;
    }
    // One request holds at most `maxClusters` text records and as many style records. Each setter was
    // validated against that bound alone, so paragraphs past it are prepared by their own request.
    if (
      records.textMutations.length + Number(preparation.text !== undefined) > this.#limits.maxClusters ||
      records.styleMutations.length + preparation.styles.length > this.#limits.maxClusters
    ) {
      this.#prepareAlone(state, measureAll || wantsMeasurement(state));
      return;
    }
    records.paragraphs.push(preparation);
    // A summary of the preparation this one replaces may still owe its glyph facts: the batch answers them first.
    if (state.deferredFacts?.pending === true) records.prior.push(state.paragraphId);
    // Only a paragraph whose summary someone will read has it serialized; its siblings stay unmeasured.
    if (!measureAll && wantsMeasurement(state)) records.measured.push(state.paragraphId);
    if (!state.created) {
      records.upserts.push({ opcode: 'upsert', paragraphId: state.paragraphId, order: state.preparedOrder });
    }
    if (preparation.text !== undefined) records.textMutations.push(preparation.text);
    for (const style of preparation.styles) records.styleMutations.push(style);
    if (!preparation.geometryChanged) return;
    const geometry = compileGeometry(
      state,
      records.regions.length,
      records.exclusions.length,
      preparation.geometryRevision,
    );
    records.constraints.push(geometry.constraint);
    for (const region of geometry.regions) records.regions.push(region);
    for (const exclusion of geometry.exclusions) records.exclusions.push(exclusion);
    for (const object of compileInlineObjects(state, preparation.geometryRevision)) {
      records.inlineObjects.push(object);
    }
  }

  /** Writes the collected records, preceded by pending removals, as the staged preparation request. */
  #stagePreparationRequest(records: PreparationRecords, measureAll: boolean): void {
    const removals = [...this.#preparationRemovals];
    const paragraphMutations: PlannerParagraphMutation[] = removals.map((removed) => ({
      opcode: 'remove',
      paragraphId: removed.paragraphId,
    }));
    for (const upsert of records.upserts) paragraphMutations.push(upsert);
    const includeMeasurement = measureAll || records.measured.length !== 0;
    this.#stagedRequestLength = this.#transport.stagePreparation(
      {
        ...this.#preparationRequestHeader(includeMeasurement),
        paragraphMutations,
        paragraphOrderMutations: EMPTY_REQUEST_ITEMS,
        textMutations: records.textMutations,
        styleMutations: records.styleMutations,
        constraints: records.constraints,
        regions: records.regions,
        exclusions: records.exclusions,
        inlineObjects: records.inlineObjects,
      },
      measureAll ? 'all' : records.measured,
      records.prior,
    );
    this.#stagedPreparation = { paragraphs: records.paragraphs, removals, includeMeasurement, prior: records.prior };
  }

  adoptPreparation(resultPointer: number, memoryBuffer: ArrayBuffer): void {
    const staged = this.#stagedPreparation;
    if (staged === undefined) throw new Error('render planner has no staged preparation');
    this.#stagedPreparation = undefined;
    this.#stagedRequestLength = 0;
    try {
      let measurements: ReadonlyMap<number, ParagraphLayoutSummary> | undefined;
      let prior: ReadonlyMap<number, GlyphFacts> | undefined;
      try {
        this.#transport.consumeStagedPreparation(
          resultPointer,
          memoryBuffer,
          staged.includeMeasurement || staged.prior.length !== 0
            ? (publication) => {
                if (staged.includeMeasurement) measurements = readPlannerMeasurements(publication);
                if (staged.prior.length !== 0) prior = readPlannerGlyphFacts(publication, true);
              }
            : undefined,
        );
      } catch (error) {
        if (!this.#transport.failureRefusedParagraph || !(error instanceof GlyphEngineStatusError)) throw error;
        this.#adoptRefusedBatch(staged, glyphEngineStatusErrorDetails(error).fault.paragraphId, error);
        this.#automaticRetries = 0;
        return;
      }
      for (const preparation of staged.paragraphs) {
        this.#settlePriorGlyphFacts(preparation.state, prior);
        this.#adoptParagraphPreparation(preparation, measurements?.get(preparation.state.paragraphId));
      }
      this.#adoptPreparedRemovals(staged.removals);
      this.#transport.acceptPreparedMutation();
      this.#automaticRetries = 0;
    } catch (error) {
      this.#engineNeedsRebuild =
        this.#transport.invalidateUnadoptedMutation() || this.#transport.failureInvalidatedRoot;
      this.#retryNextFrame();
      throw error;
    }
  }

  /**
   * Adopts a batch in which the engine refused one paragraph. It prepares in ascending paragraph order and stops
   * at the refusal, so every paragraph before it is prepared, the refused one is emptied, and the ones after it
   * were not started; those are prepared here by their own requests. The batch as a whole succeeds.
   */
  #adoptRefusedBatch(staged: StagedPreparation, refusedParagraph: number, error: unknown): void {
    const remaining: RetainedTextState[] = [];
    for (const preparation of staged.paragraphs) {
      const { state } = preparation;
      // The request's lifecycle committed whatever happened to its paragraphs.
      state.created = true;
      if (state.paragraphId < refusedParagraph) {
        // The refused batch delivered no records, so prior glyph facts it answered are unavailable.
        if (state.deferredFacts?.pending === true) {
          this.#loseGlyphFacts(state, new Error('a batch refusal discarded this summary’s glyph facts'));
        }
        this.#adoptParagraphPreparation(preparation, undefined);
      } else if (state.paragraphId === refusedParagraph) this.#markRefused(state, error);
      else remaining.push(state);
    }
    this.#adoptPreparedRemovals(staged.removals);
    this.#transport.acceptPreparedMutation();
    for (const state of remaining) {
      try {
        this.#prepareAlone(state, wantsMeasurement(state));
      } catch (failure) {
        // Another refusal is that paragraph's own; anything else is the root's and ends the batch.
        if (state.refusal === undefined) throw failure;
      }
    }
  }

  /**
   * Prepares every dirty paragraph by its own request after an engine restart. A paragraph whose request traps
   * again is the one the engine cannot hold: it is refused, the restart that trap caused forgets the others, and
   * the pass starts over without it. Each trap removes one paragraph, so the pass ends.
   */
  #prepareIsolated(measureAll: boolean): void {
    const trapping = new Map<RetainedTextState, unknown>();
    for (;;) {
      let trapped = false;
      for (const state of [...this.#unprepared]) {
        try {
          this.#prepareAlone(state, measureAll || wantsMeasurement(state));
        } catch (error) {
          if (state.refusal !== undefined) continue;
          if (!(error instanceof GlyphEngineRestartError) || !error.restarted) throw error;
          trapping.set(state, error);
          trapped = true;
          break;
        }
      }
      // The restart a trap caused marked every text unseen again, the earlier culprits included.
      for (const [state, error] of trapping) {
        state.refusal = error;
        this.#unprepared.delete(state);
      }
      if (!trapped) break;
    }
    this.#isolateNextPreparation = false;
  }

  /** Queues this root for the next frame once after a failed one, so a transient failure heals without a setter. */
  #retryNextFrame(): void {
    if (this.#automaticRetries !== 0) return;
    this.#automaticRetries = 1;
    try {
      this.#dirtyListener?.();
    } catch {
      // The failure being reported outranks a listener that could not be told about the retry.
    }
  }

  discardPreparation(): void {
    if (this.#stagedPreparation === undefined) return;
    this.#stagedPreparation = undefined;
    this.#stagedRequestLength = 0;
    this.#engineNeedsRebuild = true;
    this.#transport.discardStagedUpdate();
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
      if (staged.glyphFacts) this.#settlePublishedGlyphFacts(publication);
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
      if (this.#engineNeedsRebuild) this.#withholdAfterCapacityFailure(error);
      this.#retryNextFrame();
      throw error;
    }
  }

  /**
   * A publication the result arena cannot hold fails for the whole root, and the engine discards the root. The
   * largest paragraph is what does not fit, so it is withheld: the rebuild restates every other paragraph and
   * the next frame publishes them. The withheld one reports this error and draws nothing until its input changes.
   */
  #withholdAfterCapacityFailure(error: unknown): void {
    if (!(error instanceof GlyphEngineStatusError) || error.statusCode !== 'result-too-large') return;
    let largest: RetainedTextState | undefined;
    for (const state of this.#texts) {
      if (state.removed || state.disposed || this.#withheld.has(state)) continue;
      if (largest === undefined || state.desired.text.length > largest.desired.text.length) largest = state;
    }
    if (largest !== undefined) this.#withheld.set(largest, error);
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
    this.discardPreparation();
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
    for (const state of this.#texts) {
      this.#settleOrphanedFacts(state);
      this.#settleGlyphFacts(state);
    }
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
      if (state.preparedDesired !== undefined) attempt(() => releaseResolvedText(state.preparedDesired!));
      state.preparedDesired = undefined;
      attempt(() => state.idScope.dispose());
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
    this.#unprepared.clear();
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
        state.inspection = this.#ownedInspection(anchored);
      }
      return;
    }
    if ((semanticViewMask & masks.measurement) === 0) return;
    const measurements = readPlannerMeasurements(publication);
    for (const state of this.#texts) {
      const measurement = measurements.get(state.paragraphId);
      if (measurement === undefined) continue;
      // Publication positions the preparation a summary-only read measured: its facts are these.
      state.deferredFacts?.settle(glyphFactsOf(measurement));
      state.deferredFacts = undefined;
      state.measurement = withTextAnchor(measurement, state.desired.source.constraints?.anchor);
    }
  }

  /** Derives what the engine must be told to bring one paragraph from its prepared value to its desired one. */
  #paragraphPreparation(state: RetainedTextState): ParagraphPreparation {
    const prepared = state.prepared ? state.preparedDesired : undefined;
    const desired = state.desired;
    const styles =
      prepared === desired ? EMPTY_REQUEST_ITEMS : compileStyles(state, retainedStyleChanges(desired, prepared));
    const geometryChanged = state.geometryDirty || prepared === undefined;
    // An edit that stated its range is told to the engine as stated; a whole-string setter is compared.
    const replacement =
      statedTextReplacement(state.statedReplacement, prepared?.text, desired.text) ??
      minimalTextReplacement(prepared?.text ?? '', desired.text);
    return {
      state,
      text:
        replacement === undefined
          ? undefined
          : {
              paragraphId: state.paragraphId,
              start: replacement.start,
              deleteCount: replacement.end - replacement.start,
              insert: replacement.insert,
            },
      styles,
      geometryChanged,
      geometryRevision: state.geometryRevision + Number(geometryChanged),
      changed: prepared === undefined || replacement !== undefined || styles.length !== 0 || geometryChanged,
    };
  }

  #preparationRequestHeader(includeMeasurement: boolean, glyphFacts = false, priorFacts = false) {
    return {
      rootId: this.#transport.handle,
      codecHandle: this.#codec.handle,
      ...(this.#capabilitySet === undefined ? {} : { capabilitySet: this.#capabilitySet }),
      expectedEngineRevision: this.#engineRevision,
      consumedRevision: this.#revision,
      acknowledgedPublicationGeneration: this.#acknowledgedGeneration,
      // A summary-only read answers from flow layout and leaves positioning owed to the publication or to the next
      // read of positions; its summary computes glyph facts on first read (`#resolveGlyphFacts`), unless the
      // paragraph is positioned anyway and the engine can answer them at no cost.
      semanticViewMask:
        (includeMeasurement
          ? textShaperAbi.engine.semanticViewMasks.measurement |
            textShaperAbi.engine.semanticViewMasks.borrowedLayout |
            (glyphFacts
              ? textShaperAbi.engine.semanticViewMasks.glyphFacts
              : textShaperAbi.engine.semanticViewMasks.availableGlyphFacts)
          : 0) | (priorFacts ? textShaperAbi.engine.semanticViewMasks.priorGlyphFacts : 0),
      limits: this.#limits,
    };
  }

  /** Records that the engine now holds this paragraph's desired state, leasing it until the next preparation. */
  #markPrepared(state: RetainedTextState): void {
    const previous = state.preparedDesired;
    if (previous !== state.desired) {
      retainResolvedText(state.desired);
      state.preparedDesired = state.desired;
      if (previous !== undefined) releaseResolvedText(previous);
    }
    state.created = true;
    state.prepared = true;
    state.geometryDirty = false;
    this.#unprepared.delete(state);
  }

  #adoptParagraphPreparation(preparation: ParagraphPreparation, measurement: ParagraphLayoutSummary | undefined): void {
    const { state } = preparation;
    if (preparation.geometryChanged) commitFlowEntityRevisions(state);
    state.geometryRevision = preparation.geometryRevision;
    const facts = measurement === undefined ? undefined : deferredGlyphFacts(measurement);
    if (facts !== undefined) state.observedFacts = facts;
    if (facts?.pending === true) {
      facts.bind(() => this.#resolveGlyphFacts(state));
      state.deferredFacts = facts;
      this.#deferredFactTexts.add(state);
    }
    state.measurement =
      measurement === undefined ? undefined : withTextAnchor(measurement, state.desired.source.constraints?.anchor);
    // A summary nobody reads again is not kept current by the next preparation.
    state.measurementRead = false;
    state.inspection = undefined;
    this.#markPrepared(state);
  }

  /**
   * Records that the engine refused this paragraph and emptied it. The root is intact: siblings stay prepared,
   * the next publication withdraws what this paragraph drew, and it is restated from nothing once its input
   * changes or a read asks for it again.
   */
  #markRefused(state: RetainedTextState, error: unknown): void {
    const prepared = state.preparedDesired;
    state.preparedDesired = undefined;
    state.refusal = error;
    state.created = true;
    state.prepared = false;
    state.geometryDirty = true;
    state.committedFlowRegions = new Map();
    state.committedFlowExclusions = new Map();
    state.pendingFlowRegions = new Map();
    state.pendingFlowExclusions = new Map();
    state.measurement = undefined;
    state.inspection = undefined;
    this.#loseGlyphFacts(state, error);
    state.dirty = true;
    this.#pendingTexts.add(state);
    this.#unprepared.delete(state);
    if (prepared !== undefined) releaseResolvedText(prepared);
  }

  #adoptPreparedRemovals(removals: readonly RetainedTextState[]): void {
    for (const removed of removals) {
      this.#preparationRemovals.delete(removed);
      this.#releasePreparedOrder(removed);
      // The engine has dropped the paragraph and no publication ever carried it, so no frame has to remove it.
      if (!removed.published) {
        this.#removed.delete(removed);
        this.#retireRemoved(removed);
      }
    }
  }

  /**
   * Prepares one paragraph for a read. Returns whether the engine changed its retained preparation; a paragraph
   * that is already prepared only has its summary serialized when the read needs one.
   */
  #prepareTextCandidate(state: RetainedTextState, includeMeasurement: boolean, glyphFacts = false): boolean {
    this.#settleOrphanedFacts(state);
    const preparation = this.#paragraphPreparation(state);
    const removals = this.#preparationRemovals.size === 0 ? EMPTY_REQUEST_ITEMS : [...this.#preparationRemovals];
    const preparationChanged = preparation.changed || removals.length !== 0;
    // Requested summaries stay current; unqueried text needs only durable layout preparation.
    if (!preparationChanged && (!includeMeasurement || state.measurement !== undefined)) {
      if (state.measurement !== undefined) {
        state.measurement = withTextAnchor(state.measurement, state.desired.source.constraints?.anchor);
      }
      this.#markPrepared(state);
      return false;
    }
    // The engine is about to move this paragraph, and any it removes, past the preparation their summaries measured.
    // A removed paragraph's facts are answered now; this one's ride on the read itself.
    const priorFacts = preparationChanged && state.deferredFacts?.pending === true;
    if (preparationChanged) for (const removed of removals) this.#settleGlyphFacts(removed);
    const geometry = preparation.geometryChanged
      ? compileGeometry(state, 0, 0, preparation.geometryRevision)
      : undefined;
    // A read that creates its paragraph creates every sibling the engine has not seen too. The lifecycle is then
    // settled for the whole root, and the reads that follow carry no lifecycle rows at all.
    const creations = state.created ? EMPTY_REQUEST_ITEMS : this.#uncreatedTexts();
    const paragraphMutations: readonly PlannerParagraphMutation[] =
      state.created && removals.length === 0
        ? EMPTY_REQUEST_ITEMS
        : [
            ...removals.map((removed) => ({ opcode: 'remove' as const, paragraphId: removed.paragraphId })),
            ...(state.created ? [state] : creations).map((created) => ({
              opcode: 'upsert' as const,
              paragraphId: created.paragraphId,
              order: created.preparedOrder,
            })),
          ];
    // A read that changes nothing only serializes: it positions now rather than return facts for later.
    const answerFacts = glyphFacts || !preparationChanged;
    // So does a read whose caller read the glyph facts of the summary before, which saves that caller a second call;
    // its summary still observes whether they are read, so a caller that stops reading them stops paying for them.
    const observeFacts = !answerFacts && includeMeasurement && state.observedFacts?.read === true;
    const request: PlannerFrameUpdate = {
      ...this.#preparationRequestHeader(includeMeasurement, answerFacts || observeFacts, priorFacts),
      paragraphMutations,
      paragraphOrderMutations: EMPTY_REQUEST_ITEMS,
      textMutations: preparation.text === undefined ? EMPTY_REQUEST_ITEMS : [preparation.text],
      styleMutations: preparation.styles,
      constraints: geometry === undefined ? EMPTY_REQUEST_ITEMS : [geometry.constraint],
      regions: geometry === undefined ? EMPTY_REQUEST_ITEMS : geometry.regions,
      exclusions: geometry === undefined ? EMPTY_REQUEST_ITEMS : geometry.exclusions,
      inlineObjects: preparation.geometryChanged
        ? compileInlineObjects(state, preparation.geometryRevision)
        : EMPTY_REQUEST_ITEMS,
    };
    let measurement: ParagraphLayoutSummary | undefined;
    let prior: ReadonlyMap<number, GlyphFacts> | undefined;
    try {
      this.#transport.prepareParagraph(
        request,
        state.paragraphId,
        includeMeasurement || priorFacts
          ? (publication) => {
              if (includeMeasurement) {
                measurement = readPlannerMeasurements(publication, observeFacts).get(state.paragraphId);
              }
              if (priorFacts) prior = readPlannerGlyphFacts(publication, true);
            }
          : undefined,
      );
    } catch (error) {
      if (!this.#transport.failureRefusedParagraph) throw error;
      // The engine emptied this paragraph and committed the rest of the request, lifecycle included.
      for (const created of creations) created.created = true;
      this.#adoptPreparedRemovals(removals);
      this.#markRefused(state, error);
      throw error;
    }
    if (includeMeasurement && measurement === undefined)
      throw new Error('text engine returned no measurement for prepared text');
    const inspection = state.inspection;
    for (const created of creations) created.created = true;
    if (priorFacts) this.#settlePriorGlyphFacts(state, prior);
    this.#adoptParagraphPreparation(preparation, measurement);
    if (!preparationChanged) state.inspection = inspection;
    this.#adoptPreparedRemovals(removals);
    return preparationChanged;
  }

  #compileFrame(options: NormalizedPublishOptions, checkpointGeneration: number): PlannerFrameUpdate {
    this.#assertUniqueBaseOrders();
    const pendingTexts = [...this.#pendingTexts];
    // Semantic text, styles, and geometry were committed by a read or by the batch preparation. Publication
    // carries only renderer lifecycle/order work and compiles that exact preparation revision.
    let paragraphMutations: PlannerParagraphMutation[] | undefined;
    for (const state of this.#preparationRemovals) {
      (paragraphMutations ??= []).push({ opcode: 'remove', paragraphId: state.paragraphId });
    }
    let paragraphOrderMutations: PlannerParagraphOrderMutation[] | undefined;
    for (const state of pendingTexts) {
      if (this.#unprepared.has(state)) continue;
      if (state.lifecycleDirty) {
        (paragraphMutations ??= []).push({
          opcode: 'upsert',
          paragraphId: state.paragraphId,
          order: state.metrics.order,
        });
      }
      if (state.orderDirty) {
        (paragraphOrderMutations ??= []).push({
          paragraphId: state.paragraphId,
          orderScope: state.orderScope,
          orderRank: state.orderRank,
        });
      }
    }
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
      paragraphMutations: paragraphMutations ?? EMPTY_REQUEST_ITEMS,
      paragraphOrderMutations: paragraphOrderMutations ?? EMPTY_REQUEST_ITEMS,
      textMutations: EMPTY_REQUEST_ITEMS,
      styleMutations: EMPTY_REQUEST_ITEMS,
      constraints: EMPTY_REQUEST_ITEMS,
      regions: EMPTY_REQUEST_ITEMS,
      exclusions: EMPTY_REQUEST_ITEMS,
      inlineObjects: EMPTY_REQUEST_ITEMS,
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

  /** Forgets a removed text nothing references any more: neither the engine nor a publication the renderer holds. */
  #retireRemoved(state: RetainedTextState): void {
    this.#releasePreparedOrder(state);
    this.#texts.delete(state);
    if (!state.desiredReleased) releaseResolvedText(state.desired);
    state.desiredReleased = true;
    if (state.committed !== undefined) releaseResolvedText(state.committed);
    state.committed = undefined;
    if (state.preparedDesired !== undefined) releaseResolvedText(state.preparedDesired);
    state.preparedDesired = undefined;
    state.idScope.dispose();
  }

  #commitDesiredState(): void {
    for (const state of this.#removed) this.#retireRemoved(state);
    this.#removed.clear();
    this.#preparationRemovals.clear();
    for (const state of this.#pendingTexts) {
      if (this.#unprepared.has(state)) continue;
      if (state.preparedOrder !== state.metrics.order) this.#releasePreparedOrder(state);
    }
    for (const state of this.#pendingTexts) {
      // Held for the next frame: nothing of its new value reached this publication.
      if (this.#unprepared.has(state)) continue;
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
      state.orderDirty = false;
      this.#pendingTexts.delete(state);
    }
    this.#baseOrderValidationPending = this.#unprepared.size !== 0;
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
    this.#automaticRetries = 0;
    // Whatever was held out of this publication still needs a frame.
    if (this.#unprepared.size !== 0) this.#dirtyListener?.();
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

  /** `glyphFacts`: the caller reads positions, so the read positions now instead of leaving glyph facts deferred. */
  #assertTextQueryable(state: RetainedTextState, glyphFacts = false): void {
    this.#assertMutable();
    this.#ensureEngineRebuilt();
    if (state.disposed) throw new Error('text engine text has been disposed');
    // A withheld paragraph has no layout to read: preparing it would put it back into the publication it broke.
    if (this.#withheld.has(state)) throw this.#withheld.get(state);
    // A read is never stale: it prepares this paragraph, and only this one, when a setter left it dirty.
    if (this.#unprepared.has(state) || state.measurement === undefined) this.#prepareForRead(state, glyphFacts);
    else if (glyphFacts) this.#settleGlyphFacts(state);
    // Every query reads the summary, so the next preparation keeps it current for a caller that alternates.
    state.measurementRead = true;
  }

  /** Live paragraphs the engine does not hold yet. */
  #uncreatedTexts(): readonly RetainedTextState[] {
    const uncreated: RetainedTextState[] = [];
    for (const state of this.#unprepared) if (!state.created) uncreated.push(state);
    return uncreated;
  }

  /**
   * Prepares the paragraph a read asks about. If the engine traps, it was replaced and knows nothing, so the
   * read asks once more; a second trap means this paragraph's own input is what the engine cannot hold.
   */
  #prepareForRead(state: RetainedTextState, glyphFacts = false): void {
    try {
      this.#prepareAlone(state, true, glyphFacts);
    } catch (error) {
      if (!(error instanceof GlyphEngineRestartError) || !error.restarted) throw error;
      try {
        this.#prepareAlone(state, true, glyphFacts);
      } catch (again) {
        if (again instanceof GlyphEngineRestartError && again.restarted) {
          state.refusal = again;
          this.#unprepared.delete(state);
        }
        throw again;
      }
    }
  }

  /** Prepares one paragraph by its own request and adopts the result. */
  #prepareAlone(state: RetainedTextState, includeMeasurement: boolean, glyphFacts = false): void {
    try {
      this.#prepareTextCandidate(state, includeMeasurement, glyphFacts);
      this.#transport.acceptPreparedMutation();
    } catch (error) {
      this.#invalidateUnadoptedPreparation();
      throw error;
    }
  }

  /**
   * Re-derives glyph facts an engine restart orphaned by preparing the desired state they measured, which gives the
   * layout that preparation had (incremental equals cold). A text edited since is prepared at its measured value for
   * this one request and restated at its desired value by its next preparation.
   */
  #rederiveOrphanedFacts(state: RetainedTextState): GlyphFacts {
    this.#assertMutable();
    this.#ensureEngineRebuilt();
    // A withheld paragraph is never restated: preparing it would put it back into the publication it broke.
    if (this.#withheld.has(state)) throw this.#withheld.get(state);
    const { facts, measured } = state.orphanedFacts!;
    state.orphanedFacts = undefined;
    const desired = state.desired;
    const observed = state.observedFacts;
    const edited = measured !== desired;
    try {
      if (edited) {
        state.desired = measured;
        state.geometryDirty = true;
      }
      this.#prepareAlone(state, true, true);
      return glyphFactsOf(requirePreparedMeasurement(state));
    } catch (error) {
      // Nothing holds the measured state any more, so a later read reports this failure.
      facts.lose(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      if (edited) {
        state.desired = desired;
        state.geometryDirty = true;
        state.measurement = undefined;
        state.inspection = undefined;
        // A refusal of the measured state is not one of the desired state.
        state.refusal = undefined;
        state.dirty = true;
        this.#pendingTexts.add(state);
        this.#unprepared.add(state);
        this.#dirtyListener?.();
      }
      state.observedFacts = observed;
      releaseResolvedText(measured);
    }
  }

  /** Re-derives orphaned glyph facts before the paragraph is prepared again or retired; a failure is kept for them. */
  #settleOrphanedFacts(state: RetainedTextState): void {
    const orphaned = state.orphanedFacts;
    if (orphaned === undefined) return;
    try {
      orphaned.facts.resolve();
    } catch (error) {
      // Refused before it took the measured state (a withheld paragraph): nothing can re-derive them now.
      if (state.orphanedFacts === undefined) return;
      state.orphanedFacts = undefined;
      orphaned.facts.lose(error instanceof Error ? error : new Error(String(error)));
      releaseResolvedText(orphaned.measured);
    }
  }

  /** Answers deferred summaries from the summaries a publication returned for the paragraphs it positioned. */
  #settlePublishedGlyphFacts(publication: PlanPublication): void {
    const published = readPlannerGlyphFacts(publication, false);
    for (const state of this.#deferredFactTexts) {
      const facts = published.get(state.paragraphId);
      if (facts === undefined || state.deferredFacts === undefined) continue;
      state.deferredFacts.settle(facts);
      state.deferredFacts = undefined;
      this.#deferredFactTexts.delete(state);
    }
  }

  /** Whether an adopted summary still owes glyph facts; forgets the texts whose facts are answered. */
  #glyphFactsWanted(): boolean {
    for (const state of this.#deferredFactTexts) {
      if (state.deferredFacts?.pending !== true || state.disposed) this.#deferredFactTexts.delete(state);
    }
    return this.#deferredFactTexts.size !== 0;
  }

  /** Answers a deferred summary from the prior glyph facts the preparation that replaced it returned. */
  #settlePriorGlyphFacts(state: RetainedTextState, prior: ReadonlyMap<number, GlyphFacts> | undefined): void {
    const facts = state.deferredFacts;
    if (facts === undefined) return;
    const answered = prior?.get(state.paragraphId);
    if (answered !== undefined) {
      state.deferredFacts = undefined;
      facts.settle(answered);
    } else if (facts.pending) {
      this.#loseGlyphFacts(state, new Error('text engine returned no prior glyph facts for a deferred summary'));
    }
  }

  /**
   * The preparation a deferred summary measured can no longer be read: its facts report why when read. A failure
   * that invalidates the root rebinds them instead (`#forgetEngineState`); a refusal emptied the paragraph.
   */
  #loseGlyphFacts(state: RetainedTextState, error: unknown): void {
    const facts = state.deferredFacts;
    if (facts === undefined) return;
    state.deferredFacts = undefined;
    facts.lose(error instanceof Error ? error : new Error(String(error)));
  }

  /**
   * Resolves the glyph facts a summary-only read left deferred, while the engine still holds the preparation they
   * describe. A failure is kept for the summary to report when read; the caller's own work proceeds.
   */
  #settleGlyphFacts(state: RetainedTextState): void {
    const facts = state.deferredFacts;
    if (facts === undefined) return;
    state.deferredFacts = undefined;
    if (!facts.pending) return;
    try {
      facts.resolve();
    } catch (error) {
      facts.lose(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Positions the paragraph's current preparation, if a read left it owed, and returns its glyph facts. Runs only
   * while that preparation is the one the deferred summary measured (`#settleGlyphFacts` runs before any other).
   */
  #resolveGlyphFacts(state: RetainedTextState): GlyphFacts {
    if (this.#disposed || state.disposed || this.#engineNeedsRebuild) {
      throw new Error('the engine no longer holds the preparation this layout summary measured');
    }
    const request: PlannerFrameUpdate = {
      ...this.#preparationRequestHeader(true, true),
      paragraphMutations: EMPTY_REQUEST_ITEMS,
      paragraphOrderMutations: EMPTY_REQUEST_ITEMS,
      textMutations: EMPTY_REQUEST_ITEMS,
      styleMutations: EMPTY_REQUEST_ITEMS,
      constraints: EMPTY_REQUEST_ITEMS,
      regions: EMPTY_REQUEST_ITEMS,
      exclusions: EMPTY_REQUEST_ITEMS,
      inlineObjects: EMPTY_REQUEST_ITEMS,
    };
    let facts: GlyphFacts | undefined;
    try {
      this.#transport.prepareParagraph(request, state.paragraphId, (publication) => {
        facts = readPlannerGlyphFacts(publication, false).get(state.paragraphId);
      });
      this.#transport.acceptPreparedMutation();
    } catch (error) {
      this.#invalidateUnadoptedPreparation();
      throw error;
    }
    if (facts === undefined) throw new Error('text engine returned no measurement for prepared text');
    return facts;
  }

  #invalidateUnadoptedPreparation(): void {
    if (this.#transport.invalidateUnadoptedMutation()) this.#engineNeedsRebuild = true;
  }

  /**
   * Discards the engine's derived root after a failure and marks every live paragraph unprepared. Nothing is
   * replayed here: the next read or batch preparation restates each paragraph from its current desired value, so
   * a value assigned after the failure is the one the engine sees.
   */
  #ensureEngineRebuilt(): void {
    if (!this.#engineNeedsRebuild) return;
    this.#transport.resetDerivedRoot();
    this.#forgetEngineState();
  }

  /**
   * @internal A trap replaced the engine instance and the transport created this root again, empty. Everything
   * staged is void and the fresh root has acknowledged nothing. The next preparation isolates each paragraph in
   * its own request, so one whose input makes the engine trap is refused alone instead of trapping every frame.
   */
  _engineRestarted(): void {
    if (this.#disposed) return;
    this.#stagedBatch = undefined;
    this.#stagedPreparation = undefined;
    this.#stagedPublication = undefined;
    this.#stagedAcceptance = undefined;
    this.#stagedRequestLength = 0;
    this.#acknowledgedGeneration = 0;
    this.#isolateNextPreparation = true;
    this.#forgetEngineState();
  }

  /** Marks every live text unseen by the engine and asks the renderer for a complete checkpoint. */
  #forgetEngineState(): void {
    this.#engineRevision = 0;
    this.#revision = 0;
    this.#checkpointGeneration = checkedNextCheckpointGeneration(this.#checkpointGeneration);
    this.#preparationRemovals.clear();
    for (const state of this.#texts) {
      if (state.removed || state.disposed) continue;
      const prepared = state.preparedDesired;
      state.preparedDesired = undefined;
      state.created = false;
      state.prepared = false;
      state.refusal = undefined;
      state.committedFlowRegions = new Map();
      state.committedFlowExclusions = new Map();
      state.pendingFlowRegions = new Map();
      state.pendingFlowExclusions = new Map();
      state.measurement = undefined;
      state.inspection = undefined;
      // The restarted engine holds nothing of the measured preparation: the facts keep its desired state, and the
      // lease on it, to re-derive them from.
      const facts = state.deferredFacts;
      state.deferredFacts = undefined;
      const orphaned = facts?.pending === true && prepared !== undefined;
      if (orphaned) {
        state.orphanedFacts = { facts, measured: prepared };
        facts.bind(() => this.#rederiveOrphanedFacts(state));
      }
      state.dirty = true;
      state.lifecycleDirty = true;
      state.geometryDirty = true;
      state.orderDirty = true;
      if (prepared !== undefined && !orphaned) releaseResolvedText(prepared);
      if (this.#withheld.has(state)) {
        // Never restated: the engine does not hold it, and no preparation or publication names it.
        state.refusal = this.#withheld.get(state);
        this.#pendingTexts.delete(state);
        this.#unprepared.delete(state);
        continue;
      }
      this.#pendingTexts.add(state);
      this.#unprepared.add(state);
    }
    this.#transforms = undefined;
    this.#baseOrderValidationPending = true;
    this.#engineNeedsRebuild = false;
    this.#dirtyListener?.();
  }

  /** Whether a publication now would change anything: a prepared paragraph, a removal or a checkpoint. */
  #hasPublishableChange(): boolean {
    if (this.#removed.size !== 0 || this.#checkpointGeneration !== this.#acceptedCheckpointGeneration) return true;
    for (const state of this.#pendingTexts) if (!this.#unprepared.has(state)) return true;
    return false;
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

  get refusal(): unknown {
    return this.#state.refusal;
  }

  get keepMeasured(): boolean {
    return this.#state.keepMeasured;
  }

  set keepMeasured(value: boolean) {
    this.#state.keepMeasured = value;
  }

  preparedMeasurement(): ParagraphLayoutSummary | undefined {
    return this.#planner._preparedMeasurement(this.#state);
  }

  get awaitsPreparation(): boolean {
    return this.#planner._awaitsPreparation(this.#state);
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

  textQuery<Result>(query: TextQuery<Result>): Result {
    return this.#planner._textQuery(this.#state, query);
  }

  stateReplacement(replacement: TextRangeReplacement): void {
    this.#state.statedReplacement = replacement;
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
  const ownedText = ownTextInput(value.text, previousInput);
  // Lone surrogates are data, not a caller error: every integration reaches the engine with well-formed text.
  // A text this planner already holds was made well formed when it arrived and is not scanned again.
  const formattedText =
    ownedText.text === previous?.text || ownedText.text.isWellFormed()
      ? ownedText
      : Object.freeze({ text: ownedText.text.toWellFormed(), spans: ownedText.spans });
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
  return update.text.isWellFormed() ? update.text : update.text.toWellFormed();
}

/** Style keys that change what a glyph looks like and never where it sits or how large it is. */

/**
 * Whether `next` differs from `previous` in a layout input: anything other than colour, opacity, material and
 * the transform. This is the write a layout callback may not make.
 */
function changesLayoutInput(previous: ResolvedTextOptions, next: ResolvedTextOptions): boolean {
  const left = previous.source;
  const right = next.source;
  return (
    previous.text !== next.text ||
    previous.font.handle !== next.font.handle ||
    left.layout !== right.layout ||
    left.flow !== right.flow ||
    left.inlineObjects !== right.inlineObjects ||
    left.constraints?.anchor !== right.constraints?.anchor ||
    !sameConstraintSizes(left.constraints, right.constraints) ||
    !Object.is(left.rasterPixelRatio ?? 1, right.rasterPixelRatio ?? 1) ||
    changesLayoutStyle(left.style, right.style) ||
    previous.spans.length !== next.spans.length ||
    previous.spans.some((span, index) => {
      const other = next.spans[index]!;
      return (
        span.start !== other.start ||
        span.end !== other.end ||
        span.font?.handle !== other.font?.handle ||
        changesLayoutStyle(span.style, other.style)
      );
    })
  );
}

/** Whether an update restates the paragraph's constraint, flow or inline-object geometry. */
function updateChangesGeometry(
  update: RetainedTextUpdate,
  previous: ResolvedTextOptions,
  next: ResolvedTextOptions,
): boolean {
  return (
    next.transform.handle !== previous.transform.handle ||
    next.source.layout !== previous.source.layout ||
    !sameConstraintSizes(next.source.constraints, previous.source.constraints) ||
    (Object.hasOwn(update, 'flow') && (update.flow !== undefined || previous.source.flow !== undefined)) ||
    (Object.hasOwn(update, 'inlineObjects') &&
      (update.inlineObjects !== undefined || previous.source.inlineObjects !== undefined))
  );
}

function sameTextExceptAnchor(previous: ResolvedTextOptions, next: ResolvedTextOptions, ordinal: number): boolean {
  return (
    previous.source.constraints?.anchor !== next.source.constraints?.anchor &&
    sameEngineInputExceptAnchor(previous, next, ordinal)
  );
}

function sameEngineInputExceptAnchor(
  previous: ResolvedTextOptions,
  next: ResolvedTextOptions,
  ordinal: number,
): boolean {
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

/** Whether two resolved values state the same engine input, anchor included. */
function sameEngineInput(previous: ResolvedTextOptions, next: ResolvedTextOptions, ordinal: number): boolean {
  return (
    previous === next ||
    (previous.source.constraints?.anchor === next.source.constraints?.anchor &&
      sameEngineInputExceptAnchor(previous, next, ordinal))
  );
}

/**
 * After a frame's layout phase, a text whose owner reads every new summary waits for the next frame's phase: it is
 * published only at a layout its callback has seen. Colour and opacity change no layout, and a drawn text the engine
 * no longer holds has nothing older to keep drawing, so neither is held.
 */
function heldForObservedLayout(state: RetainedTextState): boolean {
  return (
    state.keepMeasured &&
    (state.prepared
      ? state.preparedDesired === undefined || changesLayoutInput(state.preparedDesired, state.desired)
      : !state.published)
  );
}

/** A summary is produced for an anchor that needs it, or for a caller that read the last one. */
function wantsMeasurement(state: RetainedTextState): boolean {
  return (
    state.keepMeasured ||
    (state.measurement !== undefined && state.measurementRead) ||
    state.desired.source.constraints?.anchor !== undefined
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

function textIds(state: RetainedTextState): HandleIdFactory {
  // The planner asserts it is live before it compiles; a retired text's disposed scope refuses to mint.
  return (state.ids ??= createHandleIdFactory(state.idScope, () => undefined));
}

function compileStyles(
  state: RetainedTextState,
  changes: readonly RetainedStyleChange[],
): readonly PlannerStyleMutation[] {
  if (changes.length === 0) return EMPTY_REQUEST_ITEMS;
  const desired = state.desired;
  const source = desired.source;
  return changes.map((change): PlannerStyleMutation => {
    const styleIndex = change.kind === 'root' ? 1 : change.styleIndex;
    const styleId = (state.styleIds[styleIndex] ??= engineStyleId(textIds(state), state.paragraphId, styleIndex));
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
  state: RetainedTextState,
  regionStart: number,
  exclusionStart: number,
  revision = state.geometryRevision + 1,
): Readonly<{
  constraint: PlannerConstraint;
  regions: readonly PlannerRegion[];
  exclusions: readonly PlannerExclusion[];
}> {
  const ids = textIds(state);
  const ordinary = compileEngineGeometry(
    ids,
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
    const regionId = ids('region', keyedFlowIdentity(state.paragraphId, 'region', regionKey));
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
        id: ids('exclusion', keyedFlowIdentity(state.paragraphId, 'exclusion', regionKey, exclusionKey)),
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
  state: RetainedTextState,
  contentRevision = state.geometryRevision + 1,
): readonly PlannerInlineObject[] {
  return (state.desired.source.inlineObjects ?? []).map((object, index) => ({
    ...object,
    paragraphId: state.paragraphId,
    id: textIds(state)('inline-object', `paragraph/${state.paragraphId}/inline/${index}`),
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
