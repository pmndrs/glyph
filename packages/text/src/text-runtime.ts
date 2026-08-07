import type { RasterBakeArtifact } from './bake.js';
import type { RegisteredFont } from './font.js';
import { disposeLoadedFontFromRuntime, LoadedFontImpl, type LoadedFont } from './loaded-font.js';
import {
  FontLoader,
  FontLoadError,
  FontRegistry,
  type RuntimeFontBake,
  type RuntimeFontBakeRequest,
} from './loader.js';
import { canonicalJson, deriveRasterKey } from './internal/raster-identity.js';
import { getRegisteredFontData } from './internal/registered-font.js';
import type { AnyRasterTechnique, RasterDataOf, RasterOptionsOf, RasterTechniqueTypesOf } from './raster-technique.js';
import type {
  RasterKindOf,
  RasterOptionsArgument,
  RegisteredRaster,
  RuntimeRasterBakeRequest as TechniqueRasterBakeRequest,
  RuntimeRasterBakerLoader,
  RuntimeRasterBakerModule,
} from './raster.js';
import { createRuntimeShaper, type RuntimeShaper } from './shaper.js';
import {
  createParagraphBatch,
  type ParagraphBatch,
  type ParagraphBatchController,
  type ParagraphBatchOptions,
  type ParagraphBatchPreparation,
  type ParagraphId,
  type PreparedParagraphBatchCandidate,
  type PreparedParagraphBatchRevision,
  type TextPreparationError,
} from './paragraph-batch.js';
import {
  isTextPreparationWorkerResultV1,
  type TextPreparationRequestV1,
  type TextPreparationSuccessV1,
} from './internal/text-preparation-worker-protocol.js';

export interface TextPreparationWorker {
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

export function createTextPreparationWorker(): TextPreparationWorker {
  if (typeof Worker === 'undefined') throw new TypeError('this environment does not provide module Workers');
  return new Worker(new URL('./text-preparation-worker.js', import.meta.url), { type: 'module' });
}

export interface TextRuntimeOptions {
  readonly registry?: FontRegistry;
  readonly shaper?: RuntimeShaper;
  readonly async?: Readonly<{
    readonly worker?: TextPreparationWorker;
    readonly createWorker?: () => TextPreparationWorker;
  }>;
}

export type LoadedFontInput =
  | { readonly baked: string | URL }
  | { readonly source: string | URL; readonly runtimeBake: RuntimeFontBake };

type TechniqueRasterRequest<Technique extends AnyRasterTechnique> = {
  readonly technique: Technique;
} & ([RasterOptionsOf<Technique>] extends [never]
  ? { readonly options?: never }
  : undefined extends RasterOptionsOf<Technique>
    ? { readonly options?: RasterOptionsOf<Technique> }
    : { readonly options: RasterOptionsOf<Technique> });

export interface LoadedFontRequest<Technique extends AnyRasterTechnique> {
  readonly input: LoadedFontInput;
  readonly raster: TechniqueRasterRequest<Technique>;
}

export interface TextRuntimeRevision {
  readonly revision: number;
  readonly paragraphBatches: readonly PreparedParagraphBatchRevision<AnyRasterTechnique, unknown>[];
}

export interface AsyncTextUpdateOptions {
  readonly signal?: AbortSignal;
  readonly priority?: 'background' | 'normal' | 'urgent';
  readonly onProgress?: (progress: TextUpdateProgress) => void;
}

export interface TextUpdateProgress {
  readonly revision: number;
  readonly preparedParagraphs: number;
  readonly totalParagraphs: number;
  readonly stagedGlyphs: number;
}

export type TextUpdateOutcome =
  | { readonly status: 'published'; readonly value: TextRuntimeRevision }
  | { readonly status: 'superseded'; readonly revision: number; readonly byRevision: number }
  | { readonly status: 'aborted'; readonly revision: number; readonly reason?: unknown };

export type TextUpdateResult =
  | { readonly ok: true; readonly value: TextUpdateOutcome }
  | { readonly ok: false; readonly error: TextPreparationError };

export type TextUpdateCallback = (result: TextUpdateResult) => void;

export interface TextRuntime {
  readonly registry: FontRegistry;
  readonly shaper: RuntimeShaper;
  readonly current: TextRuntimeRevision;
  readonly hasPendingChanges: boolean;
  readonly isPreparing: boolean;
  readonly disposed: boolean;

  loadFont<Technique extends AnyRasterTechnique>(
    request: LoadedFontRequest<Technique>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<LoadedFont<Technique>>;

  createParagraphBatch<Technique extends AnyRasterTechnique, Variant = undefined>(
    options: ParagraphBatchOptions<Technique, Variant>,
  ): ParagraphBatch<Technique, Variant>;

  update(): TextRuntimeRevision;
  updateAsync(options?: AsyncTextUpdateOptions): Promise<TextUpdateOutcome>;
  updateAsync(callback: TextUpdateCallback): void;
  updateAsync(options: AsyncTextUpdateOptions, callback: TextUpdateCallback): void;
  subscribe(listener: (revision: TextRuntimeRevision) => void): () => void;
  dispose(): void;
}

interface PendingTechniqueLoad {
  readonly controller: AbortController;
  readonly promise: Promise<LoadedFont<AnyRasterTechnique>>;
}

interface PendingTextUpdate {
  readonly revision: number;
  readonly snapshots: readonly ParagraphBatchPreparation[];
  readonly options: AsyncTextUpdateOptions;
  readonly complete: (result: TextUpdateResult) => void;
  readonly abort: () => void;
  settled: boolean;
  preparedParagraphs: number;
  stagedGlyphs: number;
}

type WorkerLayouts = ReadonlyMap<number, ReadonlyMap<ParagraphId, import('./layout.js').ParagraphLayout>>;

interface PendingWorkerPreparation {
  readonly operation: PendingTextUpdate;
  readonly resolve: (layouts: WorkerLayouts) => void;
  readonly reject: (error: unknown) => void;
}

export async function createTextRuntime(options: TextRuntimeOptions = {}): Promise<TextRuntime> {
  if (options.async?.worker !== undefined && options.async.createWorker !== undefined) {
    throw new TypeError('text runtime async options accept worker or createWorker, not both');
  }
  const registry = options.registry ?? options.shaper?.registry ?? new FontRegistry();
  if (options.shaper !== undefined && options.shaper.registry !== registry) {
    throw new TypeError('text runtime registry and shaper must share one ownership domain');
  }
  const shaper = options.shaper ?? (await createRuntimeShaper({ registry }));
  try {
    return new TextRuntimeImpl(registry, shaper, options.async?.worker, options.async?.createWorker);
  } catch (error) {
    if (options.shaper === undefined) shaper.dispose();
    options.async?.worker?.terminate();
    throw error;
  }
}

class TextRuntimeImpl implements TextRuntime {
  readonly registry: FontRegistry;
  readonly shaper: RuntimeShaper;
  readonly #defaultLoader: FontLoader;
  readonly #sourceLoaders = new Map<RuntimeFontBake, FontLoader>();
  readonly #loaded = new Map<RegisteredFont, Map<AnyRasterTechnique, Map<string, LoadedFont<AnyRasterTechnique>>>>();
  readonly #pending = new Map<RegisteredFont, Map<AnyRasterTechnique, Map<string, PendingTechniqueLoad>>>();
  readonly #listeners = new Set<(revision: TextRuntimeRevision) => void>();
  readonly #paragraphBatches = new Set<ParagraphBatchController>();
  readonly #pendingUpdates = new Map<number, PendingTextUpdate>();
  readonly #pendingWorkerPreparations = new Map<number, PendingWorkerPreparation>();
  readonly #workerFontHandles = new Set<number>();
  readonly #createWorker: (() => TextPreparationWorker) | undefined;
  #worker: TextPreparationWorker | undefined;
  #workerMessageListener: ((event: MessageEvent<unknown>) => void) | undefined;
  #workerErrorListener: ((event: ErrorEvent) => void) | undefined;
  #current: TextRuntimeRevision = Object.freeze({ revision: 0, paragraphBatches: Object.freeze([]) });
  #updateRequestRevision = 0;
  #disposed = false;

  constructor(
    registry: FontRegistry,
    shaper: RuntimeShaper,
    worker: TextPreparationWorker | undefined,
    createWorker: (() => TextPreparationWorker) | undefined,
  ) {
    this.registry = registry;
    this.shaper = shaper;
    this.#createWorker = createWorker;
    this.#worker = worker;
    if (worker !== undefined) this.#listenToWorker(worker);
    this.#defaultLoader = new FontLoader({ registry });
  }

  get runtime(): TextRuntime {
    return this;
  }

  get current(): TextRuntimeRevision {
    return this.#current;
  }

  get hasPendingChanges(): boolean {
    for (const batch of this.#paragraphBatches) if (batch.dirty) return true;
    return false;
  }

  get isPreparing(): boolean {
    return this.#pendingUpdates.size !== 0;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  async loadFont<Technique extends AnyRasterTechnique>(
    request: LoadedFontRequest<Technique>,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<LoadedFont<Technique>> {
    this.#assertActive();
    options.signal?.throwIfAborted();
    const font = await this.#loadRegisteredFont(request.input, options.signal);
    this.#assertActive();
    options.signal?.throwIfAborted();
    this.shaper.registerFont(font);
    const descriptor = techniqueOperations(request.raster.technique).descriptor(
      request.raster.options as RasterOptionsArgument<RasterOptionsOf<Technique>>,
    );
    const key = canonicalJson(descriptor);
    const loaded = this.#loaded.get(font)?.get(request.raster.technique)?.get(key);
    if (loaded !== undefined && !loaded.disposed) return loaded as LoadedFont<Technique>;
    const pending = this.#pending.get(font)?.get(request.raster.technique)?.get(key);
    if (pending !== undefined) return consumePending(pending.promise as Promise<LoadedFont<Technique>>, options.signal);

    const controller = new AbortController();
    const entry = {} as PendingTechniqueLoad;
    const promise = this.#loadTechnique(font, request, descriptor, controller.signal).then(
      (value) => {
        this.#deletePending(font, request.raster.technique, key, entry);
        if (this.#disposed || controller.signal.aborted) {
          value.dispose();
          throw new FontLoadError('TEXT_RUNTIME_DISPOSED', 'text runtime was disposed during font loading');
        }
        this.#loadedMap(font, request.raster.technique).set(key, value as LoadedFont<AnyRasterTechnique>);
        return value;
      },
      (error: unknown) => {
        this.#deletePending(font, request.raster.technique, key, entry);
        throw error;
      },
    );
    Object.assign(entry, { controller, promise });
    this.#pendingMap(font, request.raster.technique).set(key, entry);
    return consumePending(promise, options.signal);
  }

  createParagraphBatch<Technique extends AnyRasterTechnique, Variant = undefined>(
    options: ParagraphBatchOptions<Technique, Variant>,
  ): ParagraphBatch<Technique, Variant> {
    this.#assertActive();
    const controller = createParagraphBatch(this, options);
    this.#paragraphBatches.add(controller);
    return controller.publicBatch as ParagraphBatch<Technique, Variant>;
  }

  dirty(): void {
    this.#assertActive();
  }

  remove(batch: ParagraphBatchController): void {
    this.#paragraphBatches.delete(batch);
  }

  update(): TextRuntimeRevision {
    this.#assertActive();
    const requestRevision = ++this.#updateRequestRevision;
    this.#supersedePending(requestRevision);
    const dirty = [...this.#paragraphBatches].filter((batch) => batch.dirty);
    if (dirty.length === 0) return this.#current;
    const snapshots = this.#capture(dirty);
    const candidates: PreparedParagraphBatchCandidate[] = [];
    try {
      for (const snapshot of snapshots) candidates.push(snapshot.controller.prepare(snapshot));
      return this.#publish(candidates);
    } catch (error) {
      this.#discard(candidates);
      throw error;
    } finally {
      this.#release(snapshots);
    }
  }

  updateAsync(): Promise<TextUpdateOutcome>;
  updateAsync(callback: TextUpdateCallback): void;
  updateAsync(options: AsyncTextUpdateOptions): Promise<TextUpdateOutcome>;
  updateAsync(options: AsyncTextUpdateOptions, callback: TextUpdateCallback): void;
  updateAsync(
    optionsOrCallback: AsyncTextUpdateOptions | TextUpdateCallback = {},
    callback?: TextUpdateCallback,
  ): Promise<TextUpdateOutcome> | void {
    this.#assertActive();
    const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
    const listener = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    if (listener !== undefined) {
      this.#startAsyncUpdate(options, listener);
      return;
    }
    return new Promise<TextUpdateOutcome>((resolve, reject) => {
      this.#startAsyncUpdate(options, (result) => {
        if (result.ok) resolve(result.value);
        else reject(result.error);
      });
    });
  }

  #startAsyncUpdate(options: AsyncTextUpdateOptions, complete: (result: TextUpdateResult) => void): void {
    if (
      options.priority !== undefined &&
      options.priority !== 'background' &&
      options.priority !== 'normal' &&
      options.priority !== 'urgent'
    )
      throw new TypeError('text update priority is invalid');
    const revision = ++this.#updateRequestRevision;
    this.#supersedePending(revision);
    if (options.signal?.aborted === true) {
      queueMicrotask(() =>
        complete({ ok: true, value: { status: 'aborted', revision, reason: options.signal?.reason } }),
      );
      return;
    }
    let snapshots: readonly ParagraphBatchPreparation[];
    try {
      snapshots = this.#capture([...this.#paragraphBatches].filter((batch) => batch.dirty));
    } catch (cause) {
      const error = preparationError(cause);
      queueMicrotask(() => complete({ ok: false, error }));
      return;
    }
    let operation!: PendingTextUpdate;
    const abort = (): void => {
      this.#settle(operation, {
        ok: true,
        value: { status: 'aborted', revision, reason: options.signal?.reason },
      });
    };
    operation = {
      revision,
      snapshots,
      options,
      complete,
      abort,
      settled: false,
      preparedParagraphs: 0,
      stagedGlyphs: 0,
    };
    this.#pendingUpdates.set(revision, operation);
    options.signal?.addEventListener('abort', abort, { once: true });
    queueMicrotask(() => void this.#runAsyncUpdate(operation));
  }

  async #runAsyncUpdate(operation: PendingTextUpdate): Promise<void> {
    if (operation.settled) return;
    const totalParagraphs = operation.snapshots.reduce((total, snapshot) => total + snapshot.paragraphs.length, 0);
    let preparedParagraphs = 0;
    let stagedGlyphs = 0;
    const candidates: PreparedParagraphBatchCandidate[] = [];
    try {
      this.#reportProgress(operation, preparedParagraphs, totalParagraphs, stagedGlyphs);
      if (operation.settled) return;
      const layoutsFromWorker = await this.#prepareLayoutsInWorker(operation);
      if (operation.settled) return;
      for (let index = 0; index < operation.snapshots.length; index += 1) {
        const snapshot = operation.snapshots[index]!;
        const candidate = snapshot.controller.prepare(snapshot, layoutsFromWorker?.get(index));
        candidates.push(candidate);
        preparedParagraphs += snapshot.paragraphs.length;
        stagedGlyphs += candidate.revision.glyphRuns.reduce((total, run) => total + run.count, 0);
        this.#reportProgress(operation, preparedParagraphs, totalParagraphs, stagedGlyphs);
        if (operation.settled) {
          this.#discard(candidates);
          return;
        }
      }
      if (operation.revision !== this.#updateRequestRevision) {
        this.#discard(candidates);
        this.#settle(operation, {
          ok: true,
          value: {
            status: 'superseded',
            revision: operation.revision,
            byRevision: this.#updateRequestRevision,
          },
        });
        return;
      }
      const value = candidates.length === 0 ? this.#current : this.#publish(candidates);
      this.#settle(operation, { ok: true, value: { status: 'published', value } });
    } catch (cause) {
      this.#discard(candidates);
      if (!operation.settled) this.#settle(operation, { ok: false, error: preparationError(cause) });
    }
  }

  #prepareLayoutsInWorker(operation: PendingTextUpdate): Promise<WorkerLayouts | undefined> {
    const worker = this.#ensureWorker();
    if (worker === undefined) return Promise.resolve(undefined);
    const paragraphs: TextPreparationRequestV1['paragraphs'][number][] = [];
    for (let batch = 0; batch < operation.snapshots.length; batch += 1) {
      for (const layout of operation.snapshots[batch]!.layouts) {
        if (layout.input !== undefined) paragraphs.push({ batch, paragraph: layout.paragraph, input: layout.input });
      }
    }
    if (paragraphs.length === 0) return Promise.resolve(new Map());
    const fonts: TextPreparationRequestV1['fonts'][number][] = [];
    for (const snapshot of operation.snapshots) {
      for (const loaded of snapshot.leases) {
        const handle = loaded.font.handle;
        if (this.#workerFontHandles.has(handle)) continue;
        this.#workerFontHandles.add(handle);
        const data = getRegisteredFontData(loaded.font);
        fonts.push({
          key: loaded.font.key,
          handle,
          shapingHash: loaded.font.shapingHash,
          glyphCount: loaded.font.glyphCount,
          metrics: loaded.font.metrics,
          fontFaceIndex: data.fontFaceIndex,
          sourceHash: data.sourceHash,
          unicodeVersion: data.unicodeVersion,
          shapingSfnt: data.shapingSfnt,
          glyphExtents: data.glyphExtents,
          glyphExtentsAvailability: data.glyphExtentsAvailability,
        });
      }
    }
    return new Promise<WorkerLayouts>((resolve, reject) => {
      this.#pendingWorkerPreparations.set(operation.revision, { operation, resolve, reject });
      const request: TextPreparationRequestV1 = {
        type: 'pmndrs-text-prepare-v1',
        id: operation.revision,
        fonts,
        paragraphs,
      };
      try {
        worker.postMessage(request);
      } catch (error) {
        this.#pendingWorkerPreparations.delete(operation.revision);
        for (const font of fonts) this.#workerFontHandles.delete(font.handle);
        reject(error);
      }
    });
  }

  #receiveWorker(value: unknown): void {
    if (!isTextPreparationWorkerResultV1(value)) {
      this.#failWorker(new TypeError('text preparation Worker returned an invalid message'));
      return;
    }
    const pending = this.#pendingWorkerPreparations.get(value.id);
    if (pending === undefined) return;
    if (value.type === 'pmndrs-text-progress-v1') {
      try {
        this.#reportProgress(
          pending.operation,
          value.preparedParagraphs,
          pending.operation.snapshots.reduce((total, snapshot) => total + snapshot.paragraphs.length, 0),
          value.stagedGlyphs,
        );
      } catch (error) {
        this.#pendingWorkerPreparations.delete(value.id);
        pending.reject(error);
      }
      return;
    }
    this.#pendingWorkerPreparations.delete(value.id);
    if (value.type === 'pmndrs-text-failure-v1') {
      const error = new Error(value.error.message);
      error.name = value.error.name;
      if (value.error.stack !== undefined) error.stack = value.error.stack;
      pending.reject(error);
      return;
    }
    try {
      pending.resolve(workerLayouts(value, pending.operation.snapshots));
    } catch (error) {
      pending.reject(error);
    }
  }

  #failWorker(error: unknown): void {
    const worker = this.#worker;
    if (this.#workerMessageListener !== undefined) worker?.removeEventListener('message', this.#workerMessageListener);
    if (this.#workerErrorListener !== undefined) worker?.removeEventListener('error', this.#workerErrorListener);
    worker?.terminate();
    this.#worker = undefined;
    this.#workerMessageListener = undefined;
    this.#workerErrorListener = undefined;
    this.#workerFontHandles.clear();
    for (const pending of this.#pendingWorkerPreparations.values()) pending.reject(error);
    this.#pendingWorkerPreparations.clear();
  }

  #reportProgress(
    operation: PendingTextUpdate,
    preparedParagraphs: number,
    totalParagraphs: number,
    stagedGlyphs: number,
  ): void {
    operation.preparedParagraphs = Math.max(operation.preparedParagraphs, preparedParagraphs);
    operation.stagedGlyphs = Math.max(operation.stagedGlyphs, stagedGlyphs);
    operation.options.onProgress?.({
      revision: operation.revision,
      preparedParagraphs: operation.preparedParagraphs,
      totalParagraphs,
      stagedGlyphs: operation.stagedGlyphs,
    });
  }

  #ensureWorker(): TextPreparationWorker | undefined {
    if (this.#worker !== undefined || this.#createWorker === undefined) return this.#worker;
    const worker = this.#createWorker();
    this.#worker = worker;
    this.#listenToWorker(worker);
    return worker;
  }

  #listenToWorker(worker: TextPreparationWorker): void {
    this.#workerMessageListener = (event) => this.#receiveWorker(event.data);
    this.#workerErrorListener = (event) =>
      this.#failWorker(event.error ?? new Error(event.message || 'text preparation Worker failed'));
    worker.addEventListener('message', this.#workerMessageListener);
    worker.addEventListener('error', this.#workerErrorListener);
  }

  #cancelWorkerPreparation(operation: PendingTextUpdate): void {
    const pending = this.#pendingWorkerPreparations.get(operation.revision);
    if (pending === undefined) return;
    this.#pendingWorkerPreparations.delete(operation.revision);
    this.#worker?.postMessage({ type: 'pmndrs-text-cancel-v1', id: operation.revision });
    pending.reject(new DOMException('Text preparation was cancelled', 'AbortError'));
  }

  #capture(batches: readonly ParagraphBatchController[]): readonly ParagraphBatchPreparation[] {
    const snapshots: ParagraphBatchPreparation[] = [];
    try {
      for (const batch of batches) snapshots.push(batch.capture());
      return snapshots;
    } catch (error) {
      this.#release(snapshots);
      throw error;
    }
  }

  #release(snapshots: readonly ParagraphBatchPreparation[]): void {
    for (const snapshot of snapshots) snapshot.controller.release(snapshot);
  }

  #discard(candidates: readonly PreparedParagraphBatchCandidate[]): void {
    for (const candidate of candidates) candidate.snapshot.controller.discard(candidate);
  }

  #publish(candidates: readonly PreparedParagraphBatchCandidate[]): TextRuntimeRevision {
    for (const candidate of candidates) candidate.snapshot.controller.publish(candidate);
    this.#current = Object.freeze({
      revision: this.#current.revision + 1,
      paragraphBatches: Object.freeze([...this.#paragraphBatches].map((batch) => batch.publicBatch.current)),
    });
    for (const listener of this.#listeners) listener(this.#current);
    return this.#current;
  }

  #supersedePending(byRevision: number): void {
    for (const operation of [...this.#pendingUpdates.values()])
      this.#settle(operation, {
        ok: true,
        value: { status: 'superseded', revision: operation.revision, byRevision },
      });
  }

  #settle(operation: PendingTextUpdate, result: TextUpdateResult): void {
    if (operation.settled) return;
    operation.settled = true;
    this.#pendingUpdates.delete(operation.revision);
    operation.options.signal?.removeEventListener('abort', operation.abort);
    this.#cancelWorkerPreparation(operation);
    this.#release(operation.snapshots);
    operation.complete(result);
  }

  subscribe(listener: (revision: TextRuntimeRevision) => void): () => void {
    this.#assertActive();
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#updateRequestRevision += 1;
    for (const operation of [...this.#pendingUpdates.values()])
      this.#settle(operation, {
        ok: true,
        value: { status: 'aborted', revision: operation.revision, reason: new Error('text runtime was disposed') },
      });
    for (const techniques of this.#pending.values()) {
      for (const loads of techniques.values()) {
        for (const pending of loads.values()) pending.controller.abort();
      }
    }
    this.#pending.clear();
    for (const batch of [...this.#paragraphBatches]) batch.publicBatch.dispose();
    this.#paragraphBatches.clear();
    for (const techniques of [...this.#loaded.values()]) {
      for (const fonts of [...techniques.values()]) {
        for (const font of [...fonts.values()]) disposeLoadedFontFromRuntime(font);
      }
    }
    this.#loaded.clear();
    this.#failWorker(new Error('text runtime was disposed'));
    this.shaper.dispose();
    this.#listeners.clear();
  }

  async #loadRegisteredFont(input: LoadedFontInput, signal: AbortSignal | undefined): Promise<RegisteredFont> {
    if ('baked' in input)
      return this.#defaultLoader.load({ baked: input.baked }, signal === undefined ? {} : { signal });
    let loader = this.#sourceLoaders.get(input.runtimeBake);
    if (loader === undefined) {
      loader = new FontLoader({ registry: this.registry, runtimeBake: input.runtimeBake });
      this.#sourceLoaders.set(input.runtimeBake, loader);
    }
    return loader.load({ source: input.source, baked: null }, signal === undefined ? {} : { signal });
  }

  async #loadTechnique<Technique extends AnyRasterTechnique>(
    font: RegisteredFont,
    request: LoadedFontRequest<Technique>,
    descriptor: RasterTechniqueTypesOf<Technique>['descriptor'],
    signal: AbortSignal,
  ): Promise<LoadedFont<Technique>> {
    const technique = request.raster.technique;
    const rasterKey = await deriveRasterKey({
      descriptor,
      extension: technique.extension,
      kind: technique.kind,
      version: technique.version,
    });
    signal.throwIfAborted();
    let raster: RegisteredRaster<RasterKindOf<Technique>>;
    try {
      raster = (await font.loadRaster({ rasterKey, kind: technique.kind }, { signal })) as RegisteredRaster<
        RasterKindOf<Technique>
      >;
    } catch (error) {
      if (!isRasterMiss(error)) throw error;
      raster = await this.#runtimeBake(font, request, rasterKey, signal);
    }
    signal.throwIfAborted();
    let data: RasterDataOf<Technique>;
    try {
      data = await decodeTechnique(technique, font, raster, signal);
    } catch (error) {
      raster.dispose();
      throw error;
    }
    let value!: LoadedFontImpl<Technique>;
    value = new LoadedFontImpl({
      runtime: this,
      font,
      technique,
      raster,
      data,
      release: () => this.#releaseLoadedFont(value, canonicalJson(descriptor)),
    });
    return value;
  }

  async #runtimeBake<Technique extends AnyRasterTechnique>(
    font: RegisteredFont,
    request: LoadedFontRequest<Technique>,
    rasterKey: Awaited<ReturnType<typeof deriveRasterKey>>,
    signal: AbortSignal,
  ): Promise<RegisteredRaster<RasterKindOf<Technique>>> {
    const technique = request.raster.technique;
    const loadBaker = techniqueOperations(technique).runtimeBaker;
    if (loadBaker === undefined) {
      throw new FontLoadError('RASTER_NOT_FOUND', `${technique.kind} has no baked artifact or runtime baker`);
    }
    const registered = getRegisteredFontData(font);
    if (registered.sourceBytes === undefined) {
      throw new FontLoadError(
        'RASTER_SOURCE_UNAVAILABLE',
        `${technique.kind} runtime generation requires retained source bytes`,
      );
    }
    const imported = await loadBaker();
    signal.throwIfAborted();
    const baker = 'default' in imported ? imported.default : imported;
    assertMatchingBaker(technique, baker);
    const bakeRequest = {
      source: registered.sourceBytes.slice(),
      font,
      fontFaceIndex: registered.fontFaceIndex,
      rasterKey,
      options: request.raster.options as RasterOptionsArgument<RasterOptionsOf<Technique>>,
      signal,
    } as unknown as TechniqueRasterBakeRequest<RasterOptionsOf<Technique>>;
    const baked = await baker.bake(bakeRequest);
    assertMatchingArtifact(technique, rasterKey, baked);
    const artifacts = baked.artifacts.filter((artifact) => artifact.role === 'raster');
    if (artifacts.length !== 1) {
      throw new FontLoadError('INVALID_RASTER_ASSET', 'runtime raster generation must return one raster artifact');
    }
    const artifact = artifacts[0]!;
    const raster = await this.registry._attachGeneratedRaster(font, artifact.bytes, {
      rasterKey,
      kind: baked.kind,
      extension: baked.extension,
      version: baked.version,
    });
    return raster as RegisteredRaster<RasterKindOf<Technique>>;
  }

  #releaseLoadedFont<Technique extends AnyRasterTechnique>(font: LoadedFontImpl<Technique>, key: string): void {
    const techniques = this.#loaded.get(font.font);
    const fonts = techniques?.get(font.technique);
    if (fonts?.get(key) === font) fonts.delete(key);
    techniqueOperations(font.technique).dispose(font.data);
    font.raster.dispose();
    if (fonts?.size === 0) techniques?.delete(font.technique);
    if (techniques?.size === 0) {
      this.#loaded.delete(font.font);
      if (!this.#pending.has(font.font)) font.font.dispose();
    }
  }

  #loadedMap(font: RegisteredFont, technique: AnyRasterTechnique): Map<string, LoadedFont<AnyRasterTechnique>> {
    let techniques = this.#loaded.get(font);
    if (techniques === undefined) {
      techniques = new Map();
      this.#loaded.set(font, techniques);
    }
    let fonts = techniques.get(technique);
    if (fonts === undefined) {
      fonts = new Map();
      techniques.set(technique, fonts);
    }
    return fonts;
  }

  #pendingMap(font: RegisteredFont, technique: AnyRasterTechnique): Map<string, PendingTechniqueLoad> {
    let techniques = this.#pending.get(font);
    if (techniques === undefined) {
      techniques = new Map();
      this.#pending.set(font, techniques);
    }
    let loads = techniques.get(technique);
    if (loads === undefined) {
      loads = new Map();
      techniques.set(technique, loads);
    }
    return loads;
  }

  #deletePending(
    font: RegisteredFont,
    technique: AnyRasterTechnique,
    key: string,
    pending: PendingTechniqueLoad,
  ): void {
    const techniques = this.#pending.get(font);
    const loads = techniques?.get(technique);
    if (loads?.get(key) === pending) loads.delete(key);
    if (loads?.size === 0) techniques?.delete(technique);
    if (techniques?.size === 0) this.#pending.delete(font);
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('text runtime has been disposed');
  }
}

function preparationError(cause: unknown): TextPreparationError {
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'kind' in cause &&
    (cause.kind === 'capacity-exceeded' || cause.kind === 'preparation-failed')
  )
    return cause as TextPreparationError;
  return Object.freeze({ kind: 'preparation-failed', cause });
}

function workerLayouts(
  value: TextPreparationSuccessV1,
  snapshots: readonly ParagraphBatchPreparation[],
): WorkerLayouts {
  const expected = new Set<string>();
  for (let batch = 0; batch < snapshots.length; batch += 1)
    for (const layout of snapshots[batch]!.layouts)
      if (layout.input !== undefined) expected.add(`${String(batch)}:${String(layout.paragraph)}`);
  const batches = new Map<number, Map<ParagraphId, import('./layout.js').ParagraphLayout>>();
  for (const entry of value.layouts) {
    const key = `${String(entry.batch)}:${String(entry.paragraph)}`;
    if (!expected.delete(key)) throw new TypeError('text preparation Worker returned an unexpected paragraph');
    let paragraphs = batches.get(entry.batch);
    if (paragraphs === undefined) {
      paragraphs = new Map();
      batches.set(entry.batch, paragraphs);
    }
    const paragraph = entry.paragraph as ParagraphId;
    if (paragraphs.has(paragraph)) throw new TypeError('text preparation Worker returned a duplicate paragraph');
    paragraphs.set(paragraph, entry.layout);
  }
  if (expected.size !== 0) throw new TypeError('text preparation Worker omitted a paragraph');
  return batches;
}

async function decodeTechnique<Technique extends AnyRasterTechnique>(
  technique: Technique,
  font: RegisteredFont,
  raster: RegisteredRaster<RasterKindOf<Technique>>,
  signal: AbortSignal,
): Promise<RasterDataOf<Technique>> {
  return techniqueOperations(technique).decode(font, raster, signal);
}

interface TechniqueOperations<Technique extends AnyRasterTechnique> {
  readonly runtimeBaker?: RuntimeRasterBakerLoader<RasterKindOf<Technique>, RasterOptionsOf<Technique>>;
  descriptor(
    options: RasterOptionsArgument<RasterOptionsOf<Technique>>,
  ): RasterTechniqueTypesOf<Technique>['descriptor'];
  decode(
    font: RegisteredFont,
    raster: RegisteredRaster<RasterKindOf<Technique>>,
    signal?: AbortSignal,
  ): Promise<RasterDataOf<Technique>>;
  dispose(data: RasterDataOf<Technique>): void;
}

function techniqueOperations<Technique extends AnyRasterTechnique>(
  technique: Technique,
): TechniqueOperations<Technique> {
  return technique as unknown as TechniqueOperations<Technique>;
}

function assertMatchingBaker<Options>(
  technique: AnyRasterTechnique,
  baker: RuntimeRasterBakerModule<string, Options>,
): void {
  if (baker.kind !== technique.kind) throw new FontLoadError('RASTER_INCOMPATIBLE', 'runtime baker kind mismatch');
}

function assertMatchingArtifact(technique: AnyRasterTechnique, rasterKey: string, artifact: RasterBakeArtifact): void {
  if (
    artifact.kind !== technique.kind ||
    artifact.extension !== technique.extension ||
    artifact.version !== technique.version ||
    artifact.rasterKey !== rasterKey
  ) {
    throw new FontLoadError('RASTER_INCOMPATIBLE', 'runtime raster artifact does not match the selected technique');
  }
}

function isRasterMiss(error: unknown): boolean {
  return error instanceof FontLoadError && error.code === 'RASTER_NOT_FOUND';
}

function consumePending<Value>(promise: Promise<Value>, signal: AbortSignal | undefined): Promise<Value> {
  if (signal === undefined) return promise;
  signal.throwIfAborted();
  return new Promise<Value>((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

export type { RuntimeFontBake, RuntimeFontBakeRequest };
