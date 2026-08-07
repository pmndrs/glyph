import type { ParagraphBatch, ParagraphBatchObserver, PreparedParagraphBatchRevision } from './paragraph-batch.js';
import type { AnyRasterTechnique } from './raster-technique.js';

export interface ParagraphBatchTargetRevision {
  readonly sourceRevision: number;
  dispose(): void;
}

export interface ParagraphBatchTargetStage<TargetRevision extends ParagraphBatchTargetRevision> {
  readonly sourceRevision: number;
  commit(): TargetRevision;
  abort(): void;
}

export type ParagraphBatchTargetUpdate<TargetRevision extends ParagraphBatchTargetRevision> =
  | { readonly status: 'ready'; readonly stage: ParagraphBatchTargetStage<TargetRevision> }
  | {
      readonly status: 'pending';
      readonly ready: Promise<ParagraphBatchTargetStage<TargetRevision>>;
      cancel(reason?: unknown): void;
    };

export interface ParagraphBatchTarget<
  Technique extends AnyRasterTechnique,
  Variant,
  TargetRevision extends ParagraphBatchTargetRevision,
> {
  readonly technique: Technique;
  stage(
    previous: TargetRevision | undefined,
    next: PreparedParagraphBatchRevision<Technique, Variant>,
    options?: { readonly signal?: AbortSignal },
  ): ParagraphBatchTargetUpdate<TargetRevision>;
  dispose(): void;
}

export interface ParagraphBatchTargetError {
  readonly kind: 'target-failed';
  readonly sourceRevision: number;
  readonly cause: unknown;
}

export interface ParagraphBatchAttachment<
  Technique extends AnyRasterTechnique,
  Variant,
  TargetRevision extends ParagraphBatchTargetRevision,
> {
  readonly source: PreparedParagraphBatchRevision<Technique, Variant>;
  readonly current: TargetRevision | undefined;
  readonly candidate: ParagraphBatchTargetStage<TargetRevision> | undefined;
  readonly error: ParagraphBatchTargetError | undefined;
  prepare(): void;
  commit(): TargetRevision | undefined;
  retry(): void;
  dispose(): void;
}

interface PendingStage {
  readonly revision: number;
  readonly cancel: (reason?: unknown) => void;
}

export function attachParagraphBatch<
  Technique extends AnyRasterTechnique,
  Variant,
  TargetRevision extends ParagraphBatchTargetRevision,
>(
  batch: ParagraphBatch<Technique, Variant>,
  target: ParagraphBatchTarget<Technique, Variant, TargetRevision>,
): ParagraphBatchAttachment<Technique, Variant, TargetRevision> {
  if (target.technique !== batch.technique) throw new TypeError('paragraph batch target uses another raster technique');
  return new ParagraphBatchAttachmentImpl(batch, target);
}

class ParagraphBatchAttachmentImpl<
  Technique extends AnyRasterTechnique,
  Variant,
  TargetRevision extends ParagraphBatchTargetRevision,
> implements ParagraphBatchAttachment<Technique, Variant, TargetRevision> {
  readonly #target: ParagraphBatchTarget<Technique, Variant, TargetRevision>;
  readonly #unsubscribe: () => void;
  #source: PreparedParagraphBatchRevision<Technique, Variant>;
  #current: TargetRevision | undefined;
  #candidate: ParagraphBatchTargetStage<TargetRevision> | undefined;
  #pending: PendingStage | undefined;
  #error: ParagraphBatchTargetError | undefined;
  #attemptedRevision = -1;
  #disposed = false;

  constructor(
    batch: ParagraphBatch<Technique, Variant>,
    target: ParagraphBatchTarget<Technique, Variant, TargetRevision>,
  ) {
    this.#target = target;
    this.#source = batch.current;
    const observer: ParagraphBatchObserver<Technique, Variant> = {
      next: (source) => {
        this.#source = source;
      },
      complete: () => this.dispose(),
    };
    this.#unsubscribe = batch.subscribe(observer);
  }

  get source(): PreparedParagraphBatchRevision<Technique, Variant> {
    return this.#source;
  }
  get current(): TargetRevision | undefined {
    return this.#current;
  }
  get candidate(): ParagraphBatchTargetStage<TargetRevision> | undefined {
    return this.#candidate;
  }
  get error(): ParagraphBatchTargetError | undefined {
    return this.#error;
  }

  prepare(): void {
    this.#assertActive();
    const sourceRevision = this.#source.revision;
    if (this.#current?.sourceRevision === sourceRevision) return;
    if (this.#candidate?.sourceRevision === sourceRevision) return;
    if (this.#pending?.revision === sourceRevision) return;
    if (this.#attemptedRevision === sourceRevision) return;
    this.#discardCandidate(new DOMException('A newer source revision is being prepared', 'AbortError'));
    this.#attemptedRevision = sourceRevision;
    const controller = new AbortController();
    let update: ParagraphBatchTargetUpdate<TargetRevision>;
    try {
      update = this.#target.stage(this.#current, this.#source, { signal: controller.signal });
    } catch (cause) {
      this.#recordError(sourceRevision, cause);
      return;
    }
    if (update.status === 'ready') {
      this.#acceptStage(sourceRevision, update.stage);
      return;
    }
    this.#pending = {
      revision: sourceRevision,
      cancel: (reason) => {
        controller.abort(reason);
        update.cancel(reason);
      },
    };
    void update.ready.then(
      (stage) => {
        if (this.#disposed || this.#pending?.revision !== sourceRevision || this.#source.revision !== sourceRevision) {
          stage.abort();
          return;
        }
        this.#pending = undefined;
        this.#acceptStage(sourceRevision, stage);
      },
      (cause: unknown) => {
        if (this.#pending?.revision !== sourceRevision) return;
        this.#pending = undefined;
        if (!this.#disposed && this.#source.revision === sourceRevision) this.#recordError(sourceRevision, cause);
      },
    );
  }

  commit(): TargetRevision | undefined {
    this.#assertActive();
    const stage = this.#candidate;
    if (stage === undefined || stage.sourceRevision !== this.#source.revision) return this.#current;
    const next = stage.commit();
    if (next.sourceRevision !== stage.sourceRevision) {
      next.dispose();
      throw new TypeError('paragraph batch target committed the wrong source revision');
    }
    const previous = this.#current;
    this.#candidate = undefined;
    this.#current = next;
    this.#error = undefined;
    previous?.dispose();
    return next;
  }

  retry(): void {
    this.#assertActive();
    if (this.#pending?.revision === this.#source.revision) return;
    this.#attemptedRevision = -1;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribe();
    this.#discardCandidate(new DOMException('Paragraph batch attachment was disposed', 'AbortError'));
    this.#current?.dispose();
    this.#current = undefined;
    this.#target.dispose();
  }

  #acceptStage(sourceRevision: number, stage: ParagraphBatchTargetStage<TargetRevision>): void {
    if (stage.sourceRevision !== sourceRevision) {
      stage.abort();
      this.#recordError(sourceRevision, new TypeError('paragraph batch target staged the wrong source revision'));
      return;
    }
    this.#candidate = stage;
    this.#error = undefined;
  }

  #discardCandidate(reason: unknown): void {
    this.#pending?.cancel(reason);
    this.#pending = undefined;
    this.#candidate?.abort();
    this.#candidate = undefined;
  }

  #recordError(sourceRevision: number, cause: unknown): void {
    this.#error = Object.freeze({ kind: 'target-failed', sourceRevision, cause });
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('paragraph batch attachment has been disposed');
  }
}
