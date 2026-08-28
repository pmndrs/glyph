import { alignSpansToClusters, type GlyphPaintInput } from '../formatted-text.js';
import { textShaperAbi } from '../generated/text-shaper-abi.js';
import {
  copyParagraphLayoutInspection,
  type ParagraphLayoutInspection,
  type ParagraphLayoutSummary,
} from '../layout.js';
import type { ParagraphContentBox, ParagraphStyle } from '../text-properties.js';
import { createExactFrameBufferPool, type ExactFrameBufferPool } from '../internal/frame-transfer-pool.js';
import { compileEngineGeometry, engineStyleId, engineStyleValue } from '../engine-encoding.js';
import {
  compileValidatedTextEngineFrameUpdate,
  MAX_TEXT_ENGINE_OUTPUT_BYTES,
  type TextEngineConstraint,
  type TextEngineExclusion,
  type TextEngineFrameLimits,
  type TextEngineInlineObject,
  type TextEngineRegion,
  type TextEngineStyleMutation,
  validateTextEngineFrameRecords,
} from './frame-wire.js';
import type {
  HostFontStackBinding,
  HostMaterialBinding,
  HostOpaqueBindingLease,
  HostPolicy,
  HostResourceBinding,
  HostTransformBinding,
  TextEngineHost,
  TextEnginePublication,
  TextEngineSession,
} from './host.js';
import { TextEngineRenderPlanView, type RenderPlanTable, readTextEngineResource } from './plan-view.js';
import { readTextEngineLayouts, readTextEngineMeasurements } from './layout-query-view.js';
import type { PortableResource } from './portable-resources.js';
import {
  selectPolicyCapabilitySet,
  type MaterialHandle,
  type ParagraphId,
  type PolicyCapabilitySet,
  type ResourceHandle,
} from './render-policy.js';

const MAX_U32 = 0xffff_ffff;
const claimedTargets = new WeakSet<object>();

declare const planOriginBrand: unique symbol;
export interface PlanOrigin {
  readonly [planOriginBrand]: true;
}

declare const payloadIdentityBrand: unique symbol;
export interface PortablePayloadIdentity {
  readonly [payloadIdentityBrand]: true;
}

export type RenderPlanTableName =
  | 'resources'
  | 'buffers'
  | 'patches'
  | 'primitives'
  | 'draws'
  | 'retirements'
  | 'diagnostics';

export interface TextEngineRenderPlanReader {
  table(name: RenderPlanTableName): RenderPlanTable;
  record(table: RenderPlanTable, index: number): number;
  u8(offset: number): number;
  u16(offset: number): number;
  u32(offset: number): number;
  f32(offset: number): number;
  bytes(offset: number, byteLength: number): Uint8Array;
}

export interface BorrowedTextEngineRenderPlan extends TextEngineRenderPlanReader {
  readonly delivery: 'borrowed';
}

export interface OwnedTextEngineRenderPlan extends TextEngineRenderPlanReader {
  readonly delivery: 'owned';
}

export interface PortablePayloadLease {
  readonly identity: PortablePayloadIdentity;
  readonly techniqueId: string;
  readonly resourceName: string;
  readonly payload: PortableResource;
  readonly disposed: boolean;
  dispose(): void;
}

export interface ResolvedPlanPayload {
  readonly referenceId: ResourceHandle;
  readonly identity: PortablePayloadIdentity;
  readonly techniqueId: string;
  readonly resourceName: string;
  readonly payload: PortableResource;
}

export interface ResolvedPlanTransform {
  readonly transformIndex: number;
  readonly binding: HostTransformBinding;
}

export interface PlanCandidate {
  readonly origin: PlanOrigin;
  readonly plan: BorrowedTextEngineRenderPlan;
  readonly engineRevision: number;
  readonly planRevision: number;
  readonly publicationGeneration: number;
  acquirePayload(referenceId: ResourceHandle): PortablePayloadLease;
  resolveMaterial(materialId: MaterialHandle): HostMaterialBinding;
  resolveResource(resourceId: ResourceHandle): HostResourceBinding;
  resolveTransform(transformIndex: number): HostTransformBinding;
}

export interface AsyncPlanCandidate {
  readonly origin: PlanOrigin;
  readonly plan: OwnedTextEngineRenderPlan;
  readonly engineRevision: number;
  readonly planRevision: number;
  readonly publicationGeneration: number;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly payloads: readonly ResolvedPlanPayload[];
  readonly transforms: readonly ResolvedPlanTransform[];
}

export type PlanAcceptance = Readonly<{ accepted: true }> | Readonly<{ accepted: false; error: unknown }>;

export type AsyncPlanTargetResult =
  | Readonly<{ accepted: true; returnedBytes: Uint8Array<ArrayBuffer> }>
  | Readonly<{ accepted: false; error: unknown; returnedBytes?: Uint8Array<ArrayBuffer> }>;

export interface PlanTargetControl {
  requestCheckpoint(): void;
}

export interface PlanTarget {
  readonly delivery: 'borrowed';
  accept(candidate: PlanCandidate, signal: AbortSignal): PlanAcceptance;
  dispose(): void;
}

export interface AsyncPlanTarget {
  readonly delivery: 'owned';
  readonly maximumPlanBytes: number;
  accept(candidate: AsyncPlanCandidate, signal: AbortSignal): Promise<AsyncPlanTargetResult>;
  dispose(): void;
}

export type TextPlanTarget = PlanTarget | AsyncPlanTarget;

export interface TextEngineSpan {
  readonly start: number;
  readonly end: number;
  readonly font?: HostFontStackBinding;
  readonly material?: HostMaterialBinding;
  readonly style?: ParagraphStyle;
  readonly paint?: GlyphPaintInput;
}

export interface TextEngineFormattedText {
  readonly text: string;
  readonly spans: readonly TextEngineSpan[];
}

export type TextEngineTextInput = string | TextEngineFormattedText;

export type TextEngineRegionInput = Omit<
  TextEngineRegion,
  'id' | 'geometryRevision' | 'transformIndex' | 'exclusionStart' | 'exclusionCount'
> & {
  readonly transform: HostTransformBinding;
};

export type TextEngineExclusionInput = Omit<TextEngineExclusion, 'id' | 'regionId' | 'geometryRevision'>;

export interface TextEngineFlowRegionInput {
  readonly region: TextEngineRegionInput;
  readonly exclusions?: readonly TextEngineExclusionInput[];
}

export interface TextEngineFlowInput {
  readonly regions: readonly TextEngineFlowRegionInput[];
}

export type TextEngineInlineObjectInput = Omit<
  TextEngineInlineObject,
  'paragraphId' | 'id' | 'contentRevision' | 'materialId' | 'resourceId' | 'resourceGeneration'
> & {
  readonly material: HostMaterialBinding;
  readonly resource: HostResourceBinding;
};

export interface TextEngineLimits extends TextEngineFrameLimits {}

export interface TextEngineTextOptions {
  readonly font: HostFontStackBinding;
  readonly text: TextEngineTextInput;
  readonly material?: HostMaterialBinding;
  readonly transform?: HostTransformBinding;
  readonly order?: number;
  readonly rasterPixelRatio?: number;
  readonly contentBox?: ParagraphContentBox;
  readonly style?: ParagraphStyle;
  readonly paint?: GlyphPaintInput;
  readonly flow?: TextEngineFlowInput;
  readonly inlineObjects?: readonly TextEngineInlineObjectInput[];
}

export type TextEngineTextUpdate = Partial<Omit<TextEngineTextOptions, 'font'>> & {
  readonly font?: HostFontStackBinding;
};

export interface TextEngineText {
  readonly disposed: boolean;
  update(update: TextEngineTextUpdate): void;
  layout(): ParagraphLayoutSummary;
  glyphs(): ParagraphLayoutInspection;
  dispose(): void;
}

export interface TextEnginePublishOptions {
  readonly semanticViews?: 'none' | 'measurement' | 'layout-inspection' | 'all';
  readonly compositing?: 'ordered' | 'independent';
}

interface RetainedSessionBase {
  readonly disposed: boolean;
  createText(options: TextEngineTextOptions): TextEngineText;
  dispose(): void;
}

export interface SynchronousTextEngineSession extends RetainedSessionBase {
  publish(options?: TextEnginePublishOptions): PlanAcceptance;
}

export interface AsyncTextEngineSession extends RetainedSessionBase {
  publish(options?: TextEnginePublishOptions): Promise<PlanAcceptance>;
}

export type SessionFor<Target extends TextPlanTarget> = Target extends AsyncPlanTarget
  ? AsyncTextEngineSession
  : SynchronousTextEngineSession;

export interface TextEngineSessionOptions<Target extends TextPlanTarget> {
  readonly policy: HostPolicy;
  readonly capabilitySet?: PolicyCapabilitySet;
  readonly target: (control: PlanTargetControl) => Target;
  readonly limits: TextEngineLimits;
  readonly requestCapacity: number;
  readonly resultCapacity: number;
  readonly textCapacity: number;
}

export class TextEngineSessionDisposedError extends Error {
  constructor() {
    super('text engine session has been disposed');
    this.name = 'TextEngineSessionDisposedError';
  }
}

export class TextEngineBackpressureError extends Error {}
export class TextEngineTransportCapacityError extends Error {}
export class TextEngineTransportError extends Error {}

interface ResolvedSpan {
  readonly start: number;
  readonly end: number;
  readonly font: ReturnType<TextEngineHost['_retainFontStackBinding']> | undefined;
  readonly material: HostOpaqueBindingLease | undefined;
  readonly style: ParagraphStyle | undefined;
  readonly paint: GlyphPaintInput | undefined;
}

interface ResolvedTextOptions {
  readonly source: TextEngineTextOptions;
  readonly text: string;
  readonly spans: readonly ResolvedSpan[];
  readonly font: ReturnType<TextEngineHost['_retainFontStackBinding']>;
  readonly material: HostOpaqueBindingLease | undefined;
  readonly transform: HostOpaqueBindingLease;
  readonly flowTransforms: readonly HostOpaqueBindingLease[];
  readonly inlineMaterials: readonly HostOpaqueBindingLease[];
  readonly inlineResources: readonly HostOpaqueBindingLease[];
}

interface RetainedTextState {
  readonly paragraphId: ParagraphId;
  readonly ordinal: number;
  desired: ResolvedTextOptions;
  publishedText: string;
  publishedStyleCount: number;
  geometryRevision: number;
  published: boolean;
  dirty: boolean;
  removed: boolean;
  disposed: boolean;
  measurement: ParagraphLayoutSummary | undefined;
  inspection: ParagraphLayoutInspection | undefined;
}

interface PendingPublication {
  readonly publication: TextEnginePublication;
  readonly checkpointGeneration: number;
}

const textStates = new WeakMap<object, Readonly<{ session: RetainedTextEngineSession; state: RetainedTextState }>>();

/** @internal Constructed only by TextEngineHost after it has validated host ownership. */
export function createRetainedTextEngineSession<Target extends TextPlanTarget>(
  host: TextEngineHost,
  options: TextEngineSessionOptions<Target>,
): SessionFor<Target> {
  return new RetainedTextEngineSession(host, options) as SessionFor<Target>;
}

class RetainedTextEngineSession {
  readonly #host: TextEngineHost;
  readonly #raw: TextEngineSession;
  readonly #policy: ReturnType<TextEngineHost['_retainInstalledPolicy']>;
  readonly #capabilitySet: ReturnType<typeof selectPolicyCapabilitySet> | undefined;
  readonly #target: TextPlanTarget;
  readonly #control: TargetControlState;
  readonly #targetController = new AbortController();
  readonly #origin = Object.freeze({}) as PlanOrigin;
  readonly #limits: TextEngineLimits;
  readonly #texts = new Set<RetainedTextState>();
  readonly #removed = new Set<RetainedTextState>();
  readonly #returnedBuffers: ExactFrameBufferPool | undefined;
  #nextTextOrdinal = 1;
  #engineRevision = 0;
  #planRevision = 0;
  #acknowledgedGeneration = 0;
  #checkpointGeneration = 0;
  #acceptedCheckpointGeneration = 0;
  #pending = false;
  #disposed = false;

  constructor(host: TextEngineHost, options: TextEngineSessionOptions<TextPlanTarget>) {
    this.#host = host;
    assertSessionOptions(options);
    this.#limits = snapshotLimits(options.limits);
    const policy = host._retainInstalledPolicy(options.policy);
    let target: TextPlanTarget | undefined;
    let claimed = false;
    const control = new TargetControlState(() => {
      this.#assertActive();
      this.#checkpointGeneration = checkedNextCheckpointGeneration(this.#checkpointGeneration);
    });
    try {
      const capabilitySet =
        options.capabilitySet === undefined
          ? undefined
          : selectPolicyCapabilitySet(policy.handle, policy.descriptor, options.capabilitySet);
      target = options.target(control);
      assertTarget(target, this.#limits.maxOutputBytes);
      if (claimedTargets.has(target)) throw new TypeError('plan target is already attached to another session');
      claimedTargets.add(target);
      claimed = true;
      const handle = host._allocateRetainedSessionHandle();
      this.#raw = host._createRawSession({
        handle,
        requestCapacity: options.requestCapacity,
        resultCapacity: options.resultCapacity,
        textCapacity: options.textCapacity,
      });
      this.#target = target;
      this.#control = control;
      this.#policy = policy;
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
      policy.dispose();
      if (claimed) {
        try {
          target!.dispose();
        } catch (disposeError) {
          throw combinedFailure(error, disposeError, 'session construction and target disposal both failed');
        }
      }
      throw error;
    }
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  createText(options: TextEngineTextOptions): TextEngineText {
    this.#assertMutable();
    const ordinal = this.#nextTextOrdinal;
    const nextOrdinal = checkedNextOrdinal(ordinal);
    const desired = resolveTextOptions(this.#host, options, ordinal);
    const state: RetainedTextState = {
      paragraphId: this.#host.id('paragraph', `${this.#host.integration}/text/${ordinal}`),
      ordinal,
      desired,
      publishedText: '',
      publishedStyleCount: 0,
      geometryRevision: 0,
      published: false,
      dirty: true,
      removed: false,
      disposed: false,
      measurement: undefined,
      inspection: undefined,
    };
    try {
      this.#validateState(state);
    } catch (error) {
      releaseResolvedText(desired);
      throw error;
    }
    const text = new TextEngineTextImpl(this, state);
    textStates.set(text, { session: this, state });
    this.#texts.add(state);
    this.#nextTextOrdinal = nextOrdinal;
    return text;
  }

  publish(options?: TextEnginePublishOptions): PlanAcceptance | Promise<PlanAcceptance> {
    this.#assertMutable();
    const normalized = normalizePublishOptions(options);
    return this.#target.delivery === 'borrowed' ? this.#publishBorrowed(normalized) : this.#publishOwned(normalized);
  }

  /** @internal */
  _updateText(state: RetainedTextState, update: TextEngineTextUpdate): void {
    this.#assertMutable();
    if (state.disposed) throw new Error('text engine text has been disposed');
    if (!isNonArrayObject(update)) throw new TypeError('text engine text update must be an object');
    const source = Object.freeze({ ...state.desired.source, ...update }) as TextEngineTextOptions;
    const desired = resolveTextOptions(this.#host, source, state.ordinal);
    const candidate = { ...state, desired, dirty: true };
    try {
      this.#validateState(candidate);
    } catch (error) {
      releaseResolvedText(desired);
      throw error;
    }
    releaseResolvedText(state.desired);
    state.desired = desired;
    state.dirty = true;
    state.measurement = undefined;
    state.inspection = undefined;
  }

  /** @internal */
  _layoutText(state: RetainedTextState): ParagraphLayoutSummary {
    this.#assertTextQueryable(state);
    const cached = state.measurement;
    if (cached !== undefined) return cached;
    return this.#queryText(state, false);
  }

  /** @internal */
  _inspectText(state: RetainedTextState): ParagraphLayoutInspection {
    this.#assertTextQueryable(state);
    const cached = state.inspection;
    if (cached !== undefined) return copyParagraphLayoutInspection(cached);
    return copyParagraphLayoutInspection(this.#queryText(state, true));
  }

  /** @internal */
  _disposeText(state: RetainedTextState): void {
    if (state.disposed) return;
    this.#assertMutable();
    state.disposed = true;
    if (!state.published) {
      this.#texts.delete(state);
      releaseResolvedText(state.desired);
      return;
    }
    state.removed = true;
    state.dirty = true;
    this.#removed.add(state);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#host._assertRuntimeMutationAllowed();
    this.#disposed = true;
    this.#targetController.abort(new TextEngineSessionDisposedError());
    this.#control.dispose();
    let failure: unknown;
    const attempt = (dispose: () => void): void => {
      try {
        dispose();
      } catch (error) {
        failure ??= error;
      }
    };
    attempt(() => this.#target.dispose());
    attempt(() => this.#raw.dispose());
    for (const state of this.#texts) {
      state.disposed = true;
      attempt(() => releaseResolvedText(state.desired));
    }
    this.#texts.clear();
    this.#removed.clear();
    attempt(() => this.#policy.dispose());
    this.#returnedBuffers?.clear();
    this.#host._detachRetainedSession(this);
    if (failure !== undefined) throw failure;
  }

  #publishBorrowed(options: NormalizedPublishOptions): PlanAcceptance {
    const pending = this.#publishEngine(options);
    const { publication } = pending;
    const lease = new BorrowedPlanLease(publication, this.#raw);
    const candidate = this.#candidate(lease);
    const leaveBorrow = this.#host._enterBorrowedPlan();
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
    const bytes = this.#copyPlan(publication.bytes);
    const plan = new TextEngineRenderPlanView().bindBytes(bytes);
    const payloadLeases = this.#resolvePlanPayloads(plan);
    const candidate: AsyncPlanCandidate = Object.freeze({
      origin: this.#origin,
      plan: new OwnedPlanReader(plan),
      engineRevision: publication.engineRevision,
      planRevision: publication.planRevision,
      publicationGeneration: publication.publicationGeneration,
      bytes,
      payloads: Object.freeze(
        payloadLeases.map(({ referenceId, lease }) => ({
          referenceId: referenceId as ResourceHandle,
          identity: lease.identity,
          techniqueId: lease.techniqueId,
          resourceName: lease.resourceName,
          payload: lease.payload,
        })),
      ),
      transforms: Object.freeze(this.#resolvedTransforms()),
    });
    this.#pending = true;
    try {
      const result = await abortableTargetAcceptance(
        (this.#target as AsyncPlanTarget).accept(candidate, this.#targetController.signal),
        this.#targetController.signal,
      );
      const accepted = assertAsyncAcceptance(result, publication);
      if (accepted.returnedBytes !== undefined) this.#returnPlanBuffer(accepted.returnedBytes);
      if (accepted.accepted) this.#accept(pending);
      return accepted.accepted ? { accepted: true } : { accepted: false, error: accepted.error };
    } finally {
      this.#pending = false;
      for (const { lease } of payloadLeases) lease.dispose();
    }
  }

  #publishEngine(options: NormalizedPublishOptions): PendingPublication {
    const checkpointGeneration = this.#checkpointGeneration;
    const frame = this.#compileFrame(options, checkpointGeneration);
    const publication = this.#raw.update(frame);
    this.#engineRevision = publication.engineRevision;
    this.#cacheSemanticViews(publication, options.semanticViewMask);
    this.#commitDesiredState();
    return { publication, checkpointGeneration };
  }

  #cacheSemanticViews(publication: TextEnginePublication, semanticViewMask: number): void {
    const masks = textShaperAbi.engine.semanticViewMasks;
    if ((semanticViewMask & masks.layoutInspection) !== 0) {
      const layouts = readTextEngineLayouts(publication);
      for (const state of this.#texts) {
        const layout = layouts.get(state.paragraphId);
        if (layout === undefined) continue;
        state.measurement = layout;
        state.inspection = layout;
      }
      return;
    }
    if ((semanticViewMask & masks.measurement) === 0) return;
    const measurements = readTextEngineMeasurements(publication);
    for (const state of this.#texts) {
      const measurement = measurements.get(state.paragraphId);
      if (measurement !== undefined) state.measurement = measurement;
    }
  }

  #queryText(state: RetainedTextState, inspection: false): ParagraphLayoutSummary;
  #queryText(state: RetainedTextState, inspection: true): ParagraphLayoutInspection;
  #queryText(state: RetainedTextState, inspection: boolean): ParagraphLayoutSummary | ParagraphLayoutInspection {
    this.#assertTextQueryable(state);
    const styles = compileStyles(this.#host, state);
    const styleMutations: TextEngineStyleMutation[] = [...styles];
    for (let index = styles.length + 1; index <= state.publishedStyleCount; index += 1) {
      styleMutations.push({
        opcode: 'remove',
        paragraphId: state.paragraphId,
        styleId: engineStyleId(this.#host.id, state.paragraphId, index),
      });
    }
    const geometry = compileGeometry(this.#host, state, 0, 0);
    const textChanged = !state.published || state.publishedText !== state.desired.text;
    const request = compileValidatedTextEngineFrameUpdate({
      sessionId: this.#raw.handle,
      policyHandle: this.#policy.handle,
      ...(this.#capabilitySet === undefined ? {} : { capabilitySet: this.#capabilitySet }),
      expectedEngineRevision: this.#engineRevision,
      consumedPlanRevision: this.#planRevision,
      acknowledgedPublicationGeneration: this.#acknowledgedGeneration,
      semanticViewMask: inspection
        ? textShaperAbi.engine.semanticViewMasks.layoutInspection
        : textShaperAbi.engine.semanticViewMasks.measurement,
      limits: this.#limits,
      paragraphMutations: [
        {
          opcode: 'upsert',
          paragraphId: state.paragraphId,
          order: state.desired.source.order ?? state.ordinal - 1,
        },
      ],
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
      inlineObjects: compileInlineObjects(this.#host, state),
    });
    const publication = this.#raw.measureParagraph(request, state.paragraphId);
    if (inspection) {
      const layout = readTextEngineLayouts(publication).get(state.paragraphId);
      if (layout === undefined) throw new Error('text engine returned no layout inspection for retained text');
      state.measurement = layout;
      state.inspection = layout;
      return layout;
    }
    const measurement = readTextEngineMeasurements(publication).get(state.paragraphId);
    if (measurement === undefined) throw new Error('text engine returned no measurement for retained text');
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
    const textMutations = [...this.#texts]
      .filter((state) => !state.removed && state.dirty)
      .map((state) => ({
        paragraphId: state.paragraphId,
        start: 0,
        deleteCount: state.publishedText.length,
        insert: state.desired.text,
      }));
    const styleMutations: TextEngineStyleMutation[] = [];
    const constraints: TextEngineConstraint[] = [];
    const regions: TextEngineRegion[] = [];
    const exclusions: TextEngineExclusion[] = [];
    const inlineObjects: TextEngineInlineObject[] = [];
    for (const state of this.#texts) {
      if (state.removed || !state.dirty) continue;
      const styles = compileStyles(this.#host, state);
      styleMutations.push(...styles);
      for (let index = styles.length + 1; index <= state.publishedStyleCount; index += 1) {
        styleMutations.push({
          opcode: 'remove',
          paragraphId: state.paragraphId,
          styleId: engineStyleId(this.#host.id, state.paragraphId, index),
        });
      }
      const geometry = compileGeometry(this.#host, state, regions.length, exclusions.length);
      constraints.push(geometry.constraint);
      regions.push(...geometry.regions);
      exclusions.push(...geometry.exclusions);
      inlineObjects.push(...compileInlineObjects(this.#host, state));
    }
    return compileValidatedTextEngineFrameUpdate({
      sessionId: this.#raw.handle,
      policyHandle: this.#policy.handle,
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

  #validateState(state: RetainedTextState): void {
    const styles = compileStyles(this.#host, state);
    const geometry = compileGeometry(this.#host, state, 0, 0);
    const inlineObjects = compileInlineObjects(this.#host, state);
    validateTextEngineFrameRecords(
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
    this.#validateAggregateLimits(state);
  }

  #validateAggregateLimits(candidate: RetainedTextState): void {
    const states = [
      ...[...this.#texts].filter((state) => !state.removed && state.paragraphId !== candidate.paragraphId),
      candidate,
    ];
    const orders = new Set<number>();
    let liveStyleCount = 0;
    let regionCount = 0;
    let exclusionCount = 0;
    let inlineObjectCount = 0;
    for (const state of states) {
      const order = state.desired.source.order ?? state.ordinal - 1;
      if (orders.has(order)) throw new RangeError(`retained text order ${order} is already in use`);
      orders.add(order);
      liveStyleCount += compiledStyleCount(state);
      const flow = state.desired.source.flow;
      regionCount += flow?.regions.length ?? state.desired.source.contentBox?.columns?.count ?? 1;
      exclusionCount += flow?.regions.reduce((sum, region) => sum + (region.exclusions?.length ?? 0), 0) ?? 0;
      inlineObjectCount += state.desired.source.inlineObjects?.length ?? 0;
    }
    if (states.length > this.#limits.maxParagraphs) {
      throw new RangeError('retained texts exceed limits.maxParagraphs');
    }
    if (liveStyleCount > this.#limits.maxClusters) {
      throw new RangeError('retained text styles exceed limits.maxClusters');
    }
    if (states.length > this.#limits.maxRegions || regionCount > this.#limits.maxRegions) {
      throw new RangeError('retained text regions exceed limits.maxRegions');
    }
    if (exclusionCount > this.#limits.maxExclusions) {
      throw new RangeError('retained text exclusions exceed limits.maxExclusions');
    }
    if (inlineObjectCount > this.#limits.maxInlineObjects) {
      throw new RangeError('retained inline objects exceed limits.maxInlineObjects');
    }
    const pending = states.filter((state) => state.dirty);
    if (this.#removed.size + pending.length > this.#limits.maxParagraphs) {
      throw new RangeError('pending paragraph mutations exceed limits.maxParagraphs');
    }
    if (pending.length > this.#limits.maxClusters) {
      throw new RangeError('pending text mutations exceed limits.maxClusters');
    }
    let pendingStyleCount = 0;
    for (const state of pending) {
      const nextStyleCount = compiledStyleCount(state);
      pendingStyleCount += nextStyleCount + Math.max(0, state.publishedStyleCount - nextStyleCount);
    }
    if (pendingStyleCount > this.#limits.maxClusters) {
      throw new RangeError('pending style mutations exceed limits.maxClusters');
    }
  }

  #commitDesiredState(): void {
    for (const state of this.#removed) {
      this.#texts.delete(state);
      releaseResolvedText(state.desired);
    }
    this.#removed.clear();
    for (const state of this.#texts) {
      if (!state.dirty) continue;
      state.published = true;
      state.publishedText = state.desired.text;
      state.publishedStyleCount = compiledStyleCount(state);
      state.geometryRevision += 1;
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
      acquirePayload: (referenceId: ResourceHandle) => {
        lease.assertActive();
        return this.#portablePayload(referenceId);
      },
      resolveMaterial: (materialId: MaterialHandle) => {
        lease.assertActive();
        return this.#host._resolveOpaqueBinding('material', materialId) as HostMaterialBinding;
      },
      resolveResource: (resourceId: ResourceHandle) => {
        lease.assertActive();
        return this.#host._resolveOpaqueBinding('resource', resourceId) as HostResourceBinding;
      },
      resolveTransform: (transformIndex: number) => {
        lease.assertActive();
        return this.#host._resolveOpaqueBinding('transform', transformIndex) as HostTransformBinding;
      },
    });
  }

  #portablePayload(referenceId: ResourceHandle): PortablePayloadLease {
    const lease = this.#host._acquirePortablePayload(referenceId);
    let disposed = false;
    return Object.freeze({
      identity: lease.identity as PortablePayloadIdentity,
      techniqueId: lease.techniqueId,
      resourceName: lease.resourceName,
      payload: lease.payload,
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

  #resolvePlanPayloads(plan: TextEngineRenderPlanView): readonly Readonly<{
    referenceId: number;
    lease: PortablePayloadLease;
  }>[] {
    const table = plan.table('resources');
    const leases: Array<Readonly<{ referenceId: number; lease: PortablePayloadLease }>> = [];
    const seen = new Set<number>();
    try {
      for (let index = 0; index < table.count; index += 1) {
        const referenceId = readTextEngineResource(plan, table, index).referenceId;
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
    const transforms = new Map<number, HostTransformBinding>();
    for (const state of this.#texts) {
      transforms.set(state.desired.transform.handle, state.desired.transform.binding as HostTransformBinding);
      for (const transform of state.desired.flowTransforms) {
        transforms.set(transform.handle, transform.binding as HostTransformBinding);
      }
    }
    return [...transforms].map(([transformIndex, binding]) => ({ transformIndex, binding }));
  }

  #copyPlan(source: Uint8Array): Uint8Array<ArrayBuffer> {
    if (source.byteLength > (this.#target as AsyncPlanTarget).maximumPlanBytes) {
      throw new TextEngineTransportCapacityError('render plan exceeds the target transfer limit');
    }
    const buffer = this.#returnedBuffers!.acquire(source.byteLength);
    const bytes = new Uint8Array(buffer);
    bytes.set(source);
    return bytes;
  }

  #returnPlanBuffer(bytes: Uint8Array<ArrayBuffer>): void {
    if (!(bytes instanceof Uint8Array) || bytes.byteOffset !== 0 || bytes.byteLength !== bytes.buffer.byteLength) {
      throw new TextEngineTransportError('async target returned a non-full-span plan buffer');
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
    if (this.#pending) throw new TextEngineBackpressureError('an asynchronous plan acceptance is already pending');
  }

  #assertTextQueryable(state: RetainedTextState): void {
    this.#assertMutable();
    if (state.disposed) throw new Error('text engine text has been disposed');
  }

  #assertActive(): void {
    if (this.#disposed) throw new TextEngineSessionDisposedError();
  }
}

class TextEngineTextImpl implements TextEngineText {
  readonly #session: RetainedTextEngineSession;
  readonly #state: RetainedTextState;

  constructor(session: RetainedTextEngineSession, state: RetainedTextState) {
    this.#session = session;
    this.#state = state;
  }

  get disposed(): boolean {
    return this.#state.disposed;
  }

  update(update: TextEngineTextUpdate): void {
    this.#session._updateText(this.#state, update);
  }

  layout(): ParagraphLayoutSummary {
    return this.#session._layoutText(this.#state);
  }

  glyphs(): ParagraphLayoutInspection {
    return this.#session._inspectText(this.#state);
  }

  dispose(): void {
    this.#session._disposeText(this.#state);
  }
}

class BorrowedPlanLease {
  readonly publication: TextEnginePublication;
  readonly reader: BorrowedTextEngineRenderPlan;
  #active = true;

  constructor(publication: TextEnginePublication, session: TextEngineSession) {
    this.publication = publication;
    const view = new TextEngineRenderPlanView().bind(publication);
    this.reader = new GuardedPlanReader('borrowed', view, () => this.assertActive());
    this.#session = session;
  }

  readonly #session: TextEngineSession;

  assertActive(): void {
    if (!this.#active || this.#session.isExpired(this.publication)) {
      throw new Error('borrowed text render plan has expired');
    }
  }

  expire(): void {
    this.#active = false;
  }
}

class GuardedPlanReader implements BorrowedTextEngineRenderPlan {
  readonly delivery = 'borrowed' as const;
  readonly #view: TextEngineRenderPlanView;
  readonly #assertActive: () => void;

  constructor(_delivery: 'borrowed', view: TextEngineRenderPlanView, assertActive: () => void) {
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

class OwnedPlanReader implements OwnedTextEngineRenderPlan {
  readonly delivery = 'owned' as const;
  readonly #view: TextEngineRenderPlanView;
  constructor(view: TextEngineRenderPlanView) {
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

function normalizePublishOptions(value: TextEnginePublishOptions | undefined): NormalizedPublishOptions {
  if (value !== undefined && !isNonArrayObject(value)) throw new TypeError('publish options must be an object');
  if (value !== undefined && Object.hasOwn(value, 'policyParameters')) {
    throw new TypeError('publish policyParameters are not supported');
  }
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

function resolveTextOptions(host: TextEngineHost, value: TextEngineTextOptions, ordinal: number): ResolvedTextOptions {
  if (!isNonArrayObject(value)) throw new TypeError('text engine text options must be an object');
  validateTextScalarOptions(value, ordinal);
  const formattedText = normalizeTextInput(value.text);
  const font = host._retainFontStackBinding(value.font);
  const leases: Array<{ dispose(): void }> = [font];
  try {
    const material = value.material === undefined ? undefined : host._retainOpaqueBinding(value.material, 'material');
    if (material !== undefined) leases.push(material);
    const createdTransform = value.transform === undefined;
    const transformBinding = value.transform ?? host.createTransformBinding();
    const transform = host._retainOpaqueBinding(transformBinding, 'transform');
    leases.push(transform);
    if (createdTransform) transformBinding.dispose();
    const spans = formattedText.spans.map((span) => {
      const spanFont = span.font === undefined ? undefined : host._retainFontStackBinding(span.font);
      if (spanFont !== undefined) leases.push(spanFont);
      const spanMaterial =
        span.material === undefined ? undefined : host._retainOpaqueBinding(span.material, 'material');
      if (spanMaterial !== undefined) leases.push(spanMaterial);
      return Object.freeze({
        start: span.start,
        end: span.end,
        font: spanFont,
        material: spanMaterial,
        style: span.style,
        paint: span.paint,
      });
    });
    const flowTransforms: HostOpaqueBindingLease[] = [];
    for (const flowRegion of value.flow?.regions ?? []) {
      const retained = host._retainOpaqueBinding(flowRegion.region.transform, 'transform');
      leases.push(retained);
      flowTransforms.push(retained);
    }
    const inlineMaterials: HostOpaqueBindingLease[] = [];
    const inlineResources: HostOpaqueBindingLease[] = [];
    for (const object of value.inlineObjects ?? []) {
      const retainedMaterial = host._retainOpaqueBinding(object.material, 'material');
      leases.push(retainedMaterial);
      inlineMaterials.push(retainedMaterial);
      const retainedResource = host._retainOpaqueBinding(object.resource, 'resource');
      leases.push(retainedResource);
      inlineResources.push(retainedResource);
    }
    return {
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
    };
  } catch (error) {
    for (const lease of leases.reverse()) lease.dispose();
    throw error;
  }
}

function normalizeTextInput(value: unknown): TextEngineFormattedText {
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
      ...(span.font === undefined ? {} : { font: span.font as HostFontStackBinding }),
      ...(span.material === undefined ? {} : { material: span.material as HostMaterialBinding }),
      ...(span.style === undefined
        ? {}
        : { style: cloneAuthoredData(span.style as ParagraphStyle, `text span ${index} style`) }),
      ...(span.paint === undefined
        ? {}
        : { paint: cloneAuthoredData(span.paint as GlyphPaintInput, `text span ${index} paint`) }),
    });
  });
  return Object.freeze({ text, spans: Object.freeze(alignSpansToClusters(text, spans)) });
}

function snapshotTextOptions(
  value: TextEngineTextOptions,
  input: TextEngineFormattedText,
  font: ReturnType<TextEngineHost['_retainFontStackBinding']>,
  material: HostOpaqueBindingLease | undefined,
  transform: HostOpaqueBindingLease,
  spans: readonly ResolvedSpan[],
  flowTransforms: readonly HostOpaqueBindingLease[],
  inlineMaterials: readonly HostOpaqueBindingLease[],
  inlineResources: readonly HostOpaqueBindingLease[],
): TextEngineTextOptions {
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
          ...(span.material === undefined ? {} : { material: span.material.binding as HostMaterialBinding }),
          ...(span.style === undefined ? {} : { style: span.style }),
          ...(span.paint === undefined ? {} : { paint: span.paint }),
        }),
      ),
    ),
  });
  return Object.freeze({
    ...snapshot,
    font: font.binding,
    text,
    ...(material === undefined ? {} : { material: material.binding as HostMaterialBinding }),
    transform: transform.binding as HostTransformBinding,
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
                    transform: flowTransforms[index]!.binding as HostTransformBinding,
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
                material: inlineMaterials[index]!.binding as HostMaterialBinding,
                resource: inlineResources[index]!.binding as HostResourceBinding,
              });
            }),
          ),
        }),
  });
}

function validateTextScalarOptions(value: TextEngineTextOptions, ordinal: number): void {
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

function compileStyles(host: TextEngineHost, state: RetainedTextState): readonly TextEngineStyleMutation[] {
  const desired = state.desired;
  const source = desired.source;
  const root: TextEngineStyleMutation = {
    opcode: 'upsert',
    paragraphId: state.paragraphId,
    styleId: engineStyleId(host.id, state.paragraphId, 1),
    cascadeOrder: 0,
    start: 0,
    end: desired.text.length,
    root: true,
    value: engineStyleValue(source.style ?? {}, source.paint, 0, desired.text.length, {
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
        styleId: engineStyleId(host.id, state.paragraphId, index + 2),
        cascadeOrder: index + 1,
        start: span.start,
        end: span.end,
        value: engineStyleValue(span.style ?? {}, span.paint, span.start, span.end, {
          ...(span.font === undefined ? {} : { fontStackHandle: span.font.handle as never }),
          ...(span.material === undefined ? {} : { materialId: span.material.handle as MaterialHandle }),
        }),
      })),
  ];
}

function compiledStyleCount(state: RetainedTextState): number {
  let count = 1;
  for (const span of state.desired.spans) count += Number(span.start !== span.end);
  return count;
}

function compileGeometry(
  host: TextEngineHost,
  state: RetainedTextState,
  regionStart: number,
  exclusionStart: number,
): Readonly<{
  constraint: TextEngineConstraint;
  regions: readonly TextEngineRegion[];
  exclusions: readonly TextEngineExclusion[];
}> {
  const revision = state.geometryRevision + 1;
  const ordinary = compileEngineGeometry(
    host.id,
    state.paragraphId,
    state.desired.transform.handle,
    revision,
    state.desired.source.contentBox,
    regionStart,
    state.desired.text.length,
  );
  const flow = state.desired.source.flow;
  if (flow === undefined) return { ...ordinary, exclusions: [] };
  const regions: TextEngineRegion[] = [];
  const exclusions: TextEngineExclusion[] = [];
  for (const [regionIndex, input] of flow.regions.entries()) {
    const transform = state.desired.flowTransforms[regionIndex]!;
    const firstExclusion = exclusionStart + exclusions.length;
    const regionId = host.id('region', `paragraph/${state.paragraphId}/flow/${regionIndex}`);
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
        id: host.id('exclusion', `paragraph/${state.paragraphId}/flow/${regionIndex}/exclusion/${index}`),
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

function compileInlineObjects(host: TextEngineHost, state: RetainedTextState): readonly TextEngineInlineObject[] {
  return (state.desired.source.inlineObjects ?? []).map((object, index) => ({
    ...object,
    paragraphId: state.paragraphId,
    id: host.id('inline-object', `paragraph/${state.paragraphId}/inline/${index}`),
    contentRevision: state.geometryRevision + 1,
    materialId: state.desired.inlineMaterials[index]!.handle as MaterialHandle,
    resourceId: state.desired.inlineResources[index]!.handle as ResourceHandle,
    resourceGeneration: 1,
  }));
}

function releaseResolvedText(value: ResolvedTextOptions): void {
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

function assertSessionOptions(value: unknown): asserts value is TextEngineSessionOptions<TextPlanTarget> {
  if (!isNonArrayObject(value)) throw new TypeError('text engine session options must be an object');
  if (typeof value.target !== 'function') throw new TypeError('text engine session target must be a factory');
  positiveU32(value.requestCapacity, 'requestCapacity');
  positiveU32(value.resultCapacity, 'resultCapacity');
  positiveU32(value.textCapacity, 'textCapacity');
  snapshotLimits(value.limits);
}

function snapshotLimits(value: unknown): TextEngineLimits {
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
  }) as TextEngineLimits;
  for (const [name, limit] of Object.entries(snapshot)) positiveU32(limit, name);
  if (snapshot.maxOutputBytes < textShaperAbi.layouts.engineResult.size) {
    throw new RangeError('maxOutputBytes cannot hold a text engine result header');
  }
  if (snapshot.maxOutputBytes > MAX_TEXT_ENGINE_OUTPUT_BYTES) {
    throw new RangeError('maxOutputBytes exceeds the text engine limit');
  }
  return snapshot;
}

function assertTarget(value: unknown, minimumPlanBytes: number): asserts value is TextPlanTarget {
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
    if (!this.#active) throw new TextEngineSessionDisposedError();
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
  publication: TextEnginePublication,
): Readonly<{ accepted: boolean; error?: unknown; returnedBytes?: Uint8Array<ArrayBuffer> }> {
  const accepted = assertAcceptance(value);
  const returnedBytes = isNonArrayObject(value) ? value.returnedBytes : undefined;
  if (returnedBytes !== undefined) {
    if (
      !(returnedBytes instanceof Uint8Array) ||
      returnedBytes.byteOffset !== 0 ||
      returnedBytes.byteLength !== publication.bytes.byteLength ||
      returnedBytes.buffer.byteLength !== publication.bytes.byteLength
    ) {
      throw new TextEngineTransportError('async target returned the wrong plan buffer');
    }
    let returnedPlan: TextEngineRenderPlanView;
    try {
      returnedPlan = new TextEngineRenderPlanView().bindBytes(returnedBytes);
    } catch (cause) {
      throw new TextEngineTransportError('async target returned malformed plan bytes', { cause });
    }
    const layout = textShaperAbi.layouts.engineResult;
    if (
      returnedPlan.u32(layout.engineRevision) !== publication.engineRevision ||
      returnedPlan.u32(layout.planRevision) !== publication.planRevision ||
      returnedPlan.u32(layout.publicationGeneration) !== publication.publicationGeneration
    ) {
      throw new TextEngineTransportError('async target returned bytes for a different publication');
    }
  }
  if (accepted.accepted && returnedBytes === undefined) {
    throw new TextEngineTransportError('accepted async plan did not return its transfer buffer');
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
    const abort = (): void => reject(signal.reason ?? new TextEngineSessionDisposedError());
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
