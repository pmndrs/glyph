import { createEngine, type GlyphDisplayListProjector } from './create-engine.js';
import {
  type AnyGlyphBindings,
  type CommandBufferView,
  type GlyphRenderer,
  type GlyphSchema,
  type PreparedRendererCommit,
  type RendererContext,
  type ResolveContext,
  type ResourceLease,
  type TransformUpdate,
} from '../config/glyph.js';
import type { Codec } from '../config/glyph.js';
import type { HandleMaterialBinding, HandleTransformBinding } from './handle-state.js';
import type { PlanAcceptance, PlanCandidate, PlanTarget } from './render-planner.js';
import type { BorrowedTypedCommandBuffer } from './typed-command-buffer.js';

type PlanTargetConfig<Bindings extends AnyGlyphBindings, Result, Root, CodecValue extends Codec> = Readonly<{
  schema: GlyphSchema<Bindings, Root>;
  resolve(context: ResolveContext<Bindings['resource']>): ResourceLease<Bindings['resource']>;
  renderer(context: RendererContext<Bindings, Result, CodecValue>): GlyphRenderer<Bindings, Result>;
}>;

/** Inputs for one renderer-neutral configured plan target. */
export interface CreateGlyphPlanTargetOptions<
  Bindings extends AnyGlyphBindings,
  Result,
  Root,
  CodecValue extends Codec,
> {
  readonly config: PlanTargetConfig<Bindings, Result, Root, CodecValue>;
  readonly codec: CodecValue;
  readonly root: Root;
  readonly defaultRenderer?: GlyphRenderer<Bindings, Result>;
  readonly materialInput: (binding: HandleMaterialBinding) => Bindings['materialInput'];
  readonly transformInput: (binding: HandleTransformBinding) => Bindings['transformInput'];
}

/** One configured synchronous plan target and its most recently committed renderer result. */
export interface GlyphPlanTarget<Bindings extends AnyGlyphBindings, Result> extends PlanTarget {
  readonly lastResult: Result;
  syncTransforms(updates?: readonly TransformUpdate<Bindings['transform']>[]): void;
  dispose(): void;
}

/**
 * Creates the shared decode, bind, prepare, commit, and cleanup boundary for one publication root.
 * The returned target owns the configured renderer, optional built-in renderer, and command binder.
 */
export function createGlyphPlanTarget<Bindings extends AnyGlyphBindings, Result, Root, CodecValue extends Codec>(
  options: CreateGlyphPlanTargetOptions<Bindings, Result, Root, CodecValue>,
): GlyphPlanTarget<Bindings, Result> {
  return new ConfiguredGlyphPlanTarget(options);
}

function applyGlyphPublication<Bindings extends AnyGlyphBindings, Result>(
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

class ConfiguredGlyphPlanTarget<
  Bindings extends AnyGlyphBindings,
  Result,
  Root,
  CodecValue extends Codec,
> implements GlyphPlanTarget<Bindings, Result> {
  readonly delivery = 'borrowed' as const;
  readonly #projector;
  readonly #defaultRenderer: GlyphRenderer<Bindings, Result> | undefined;
  readonly #configuredRenderer: GlyphRenderer<Bindings, Result>;
  readonly #renderer: GlyphRenderer<Bindings, Result>;
  readonly #rendererAbort = new AbortController();
  #result: Readonly<{ committed: false }> | Readonly<{ committed: true; value: Result }> = Object.freeze({
    committed: false,
  });
  #transforms: readonly TransformUpdate<Bindings['transform']>[] = Object.freeze([]);
  #disposed = false;

  constructor(options: CreateGlyphPlanTargetOptions<Bindings, Result, Root, CodecValue>) {
    this.#projector = createEngine({
      config: options.config,
      codec: options.codec,
      root: options.root,
      materialInput: options.materialInput,
      transformInput: options.transformInput,
    });
    this.#defaultRenderer = options.defaultRenderer;
    const configured = options.config.renderer(
      Object.freeze({
        drawRoot: options.config.schema.drawRoot(options.root),
        signal: this.#rendererAbort.signal,
        codec: options.codec,
        ...(options.defaultRenderer === undefined ? {} : { defaultRenderer: options.defaultRenderer }),
      }),
    );
    this.#configuredRenderer = configured;
    this.#renderer = Object.freeze({
      decode: (view: CommandBufferView<Bindings>) => {
        const prepared = configured.decode(view);
        const transforms =
          view.displayList.kind === 'replace'
            ? Object.freeze(
                Array.from(view.displayList.value.transforms, ({ value }) => Object.freeze({ transform: value })),
              )
            : this.#transforms;
        let settled = false;
        return Object.freeze({
          result: prepared.result,
          commit: () => {
            if (settled) throw new Error('Glyph renderer preparation is already settled');
            settled = true;
            prepared.commit();
            this.#result = Object.freeze({ committed: true, value: prepared.result });
            this.#transforms = transforms;
          },
          discard: () => {
            if (settled) return;
            settled = true;
            prepared.discard();
          },
        });
      },
      syncTransforms: (updates: readonly TransformUpdate<Bindings['transform']>[]) =>
        configured.syncTransforms(updates),
      dispose: () => configured.dispose(),
    });
  }

  get lastResult(): Result {
    if (!this.#result.committed) throw new Error('Glyph plan target has not committed a renderer result');
    return this.#result.value;
  }

  accept(candidate: PlanCandidate, signal: AbortSignal): PlanAcceptance {
    if (this.#disposed) return { accepted: false, error: new Error('Glyph plan target has been disposed') };
    return applyGlyphPublication(candidate, signal, this.#projector, this.#renderer);
  }

  syncTransforms(updates: readonly TransformUpdate<Bindings['transform']>[] = this.#transforms): void {
    if (this.#disposed) throw new Error('Glyph plan target has been disposed');
    this.#renderer.syncTransforms(updates);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#rendererAbort.abort(new DOMException('Glyph plan target disposed', 'AbortError'));
    let failure: unknown;
    const release = (dispose: () => void): void => {
      try {
        dispose();
      } catch (error) {
        failure ??= error;
      }
    };
    release(() => this.#renderer.dispose());
    if (this.#defaultRenderer !== undefined && this.#defaultRenderer !== this.#configuredRenderer) {
      release(() => this.#defaultRenderer?.dispose());
    }
    release(() => this.#projector.dispose());
    if (failure !== undefined) throw failure;
  }
}
