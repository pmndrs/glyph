import type { AnyRasterTechnique } from '../raster-technique.js';
import { createEngine } from './create-engine.js';
import {
  applyGlyphPublication,
  type AnyGlyphBindings,
  type CommandBufferView,
  type GlyphConfig,
  type GlyphHandle,
  type GlyphRenderer,
  type TransformUpdate,
} from './glyph-config.js';
import type { Codec } from './glyph-config.js';
import type { PlanAcceptance, PlanCandidate, PlanTarget } from './render-planner.js';

type PlanTargetConfig<Bindings extends AnyGlyphBindings, Result, PortableResource, Root> = Pick<
  GlyphConfig<GlyphHandle, Bindings, Result, PortableResource, Readonly<Record<string, AnyRasterTechnique>>, Root>,
  'schema' | 'resolve' | 'renderer'
>;

/** Inputs for one renderer-neutral configured plan target. */
export interface CreateGlyphPlanTargetOptions<Bindings extends AnyGlyphBindings, Result, PortableResource, Root> {
  readonly config: PlanTargetConfig<Bindings, Result, PortableResource, Root>;
  readonly codec: Codec;
  readonly root: Root;
  readonly defaultRenderer?: GlyphRenderer<Bindings, Result>;
}

/** One configured synchronous plan target and its most recently committed renderer result. */
export interface GlyphPlanTarget<Bindings extends AnyGlyphBindings, Result> extends PlanTarget {
  readonly lastResult: Result;
  syncTransforms(updates: readonly TransformUpdate<Bindings['transform']>[]): void;
  dispose(): void;
}

/**
 * Creates the shared decode, bind, prepare, commit, and cleanup boundary for one publication root.
 * The returned target owns the configured renderer, optional built-in renderer, and command binder.
 */
export function createGlyphPlanTarget<Bindings extends AnyGlyphBindings, Result, PortableResource, Root>(
  options: CreateGlyphPlanTargetOptions<Bindings, Result, PortableResource, Root>,
): GlyphPlanTarget<Bindings, Result> {
  return new ConfiguredGlyphPlanTarget(options);
}

class ConfiguredGlyphPlanTarget<
  Bindings extends AnyGlyphBindings,
  Result,
  PortableResource,
  Root,
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
  #disposed = false;

  constructor(options: CreateGlyphPlanTargetOptions<Bindings, Result, PortableResource, Root>) {
    this.#projector = createEngine({ config: options.config, codec: options.codec, root: options.root });
    this.#defaultRenderer = options.defaultRenderer;
    const configured = options.config.renderer(
      Object.freeze({
        drawRoot: options.config.schema.drawRoot(options.root),
        signal: this.#rendererAbort.signal,
        ...(options.defaultRenderer === undefined ? {} : { defaultRenderer: options.defaultRenderer }),
      }),
    );
    this.#configuredRenderer = configured;
    this.#renderer = Object.freeze({
      decode: (view: CommandBufferView<Bindings>) => {
        const prepared = configured.decode(view);
        let settled = false;
        return Object.freeze({
          result: prepared.result,
          commit: () => {
            if (settled) throw new Error('Glyph renderer preparation is already settled');
            settled = true;
            prepared.commit();
            this.#result = Object.freeze({ committed: true, value: prepared.result });
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

  syncTransforms(updates: readonly TransformUpdate<Bindings['transform']>[]): void {
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
