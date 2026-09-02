import type { AnyRasterTechnique, ColorInput, Font, FontStack } from '@pmndrs/glyph';
import {
  type BackendFontBinding,
  type BackendFontStackBinding,
  type BackendTransformBinding,
  type BackendPolicy,
  type PlanCandidate,
  type PlanTarget,
  type RenderPlanner,
  type RendererContext,
  type RetainedText,
  type GlyphEngine,
  applyGlyphPublication,
  type BorrowedBoundCommandBuffer,
  type Codec,
  type GlyphRenderer,
  createEngine,
  type GlyphCommandBufferBinder,
} from '@pmndrs/glyph/core';

import type { ExampleDrawList } from './draw-list.js';
import { exampleCapabilitySet, exampleRenderPolicyDescriptor } from './policy.js';
import type { ExampleBindings, ExampleGlyphConfig, ExampleRootContext } from './config.js';

type ExampleAbortSignal = RendererContext<ExampleBindings>['signal'];
interface ExampleAbortController {
  readonly signal: ExampleAbortSignal;
  abort(reason?: unknown): void;
}
const ExampleAbortController = (
  globalThis as unknown as {
    readonly AbortController: new () => ExampleAbortController;
  }
).AbortController;

const EXAMPLE_LIMITS = Object.freeze({
  maxParagraphs: 64,
  maxClusters: 16_384,
  maxLines: 4_096,
  maxRegions: 256,
  maxExclusions: 256,
  maxInlineObjects: 256,
  maxSlotsPerBand: 32,
  maxOutputBytes: 16 * 1024 * 1024,
});

/** Initial state for one retained example-renderer text instance. */
export interface ExampleTextOptions {
  readonly font: BackendFontStackBinding;
  readonly text: string;
  readonly fontSize?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rasterPixelRatio?: number;
  readonly color?: ColorInput;
  readonly opacity?: number;
}

/** Desired-state changes accepted by an example-renderer text instance. */
export interface ExampleTextUpdate {
  readonly font?: BackendFontStackBinding;
  readonly text?: string;
  readonly fontSize?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rasterPixelRatio?: number;
  readonly color?: ColorInput;
  readonly opacity?: number;
}

/** A complete third-party integration using root assets and the public `/core` backend contract. */
export class ExampleTextEngine {
  readonly #backend;
  readonly #policy: BackendPolicy;
  readonly #target: ExamplePlanTarget;
  #planner: RenderPlanner | undefined;
  #disposed = false;

  constructor(glyphEngine: GlyphEngine, config: ExampleGlyphConfig, root: ExampleRootContext) {
    this.#backend = glyphEngine.createBackend({ integration: '@pmndrs/glyph-example-renderer' });
    let codec: Codec | undefined;
    try {
      this.#policy = this.#backend.installPolicy((ids) => {
        codec =
          config?.encode({ integration: '@pmndrs/glyph-example-renderer', ids }) ??
          Object.freeze({ descriptor: exampleRenderPolicyDescriptor(ids) });
        return codec.descriptor;
      });
    } catch (error) {
      this.#backend.dispose();
      throw error;
    }
    if (codec === undefined) throw new Error('example codec was not created during policy installation');
    this.#target = new ExamplePlanTarget(config, codec, root);
  }

  /** Binds one immutable font to this renderer backend. */
  bindFont<Technique extends AnyRasterTechnique>(font: Font<Technique>): BackendFontBinding<Technique> {
    this.#assertActive();
    return this.#backend.bindFont(font);
  }

  /** Binds an ordered immutable font stack to this renderer backend. */
  bindFontStack<Technique extends AnyRasterTechnique>(
    stack: FontStack<Technique, Font<Technique>>,
  ): BackendFontStackBinding {
    this.#assertActive();
    return this.#backend.bindFontStack(stack);
  }

  /** Opens the example engine's single render planner. */
  openPlanner(): RenderPlanner {
    this.#assertActive();
    if (this.#planner !== undefined) throw new Error('example engine already has an open render planner');
    this.#planner = this.#backend.createPlanner({
      policy: this.#policy,
      capabilitySet: exampleCapabilitySet,
      target: () => this.#target,
      limits: EXAMPLE_LIMITS,
      requestCapacity: 64 * 1024,
      resultCapacity: 256 * 1024,
      textCapacity: 16 * 1024,
    });
    return this.#planner;
  }

  /** Creates one retained text instance in the open planner. */
  createText(options: ExampleTextOptions): ExampleText {
    const planner = this.#requirePlanner();
    return new ExampleText(planner, () => this.publish(), this.#backend.createTransformBinding(), options);
  }

  /** Publishes current desired state and returns the accepted decoded draw list. */
  publish(): ExampleDrawList {
    const result = this.#requirePlanner().publish();
    if (!result.accepted) throw result.error;
    return this.#target.lastDrawList;
  }

  /** Disposes the backend, planner, target, and retained payload leases. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#backend.dispose();
    this.#planner = undefined;
  }

  #requirePlanner(): RenderPlanner {
    this.#assertActive();
    return this.#planner ?? this.openPlanner();
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('example engine is disposed');
  }
}

/** One retained text instance owned by an {@link ExampleTextEngine} plan. */
export class ExampleText {
  readonly #text: RetainedText;
  readonly #publish: () => ExampleDrawList;
  readonly #transform: BackendTransformBinding;
  #state: NormalizedExampleTextOptions;
  #disposed = false;

  constructor(
    planner: RenderPlanner,
    publish: () => ExampleDrawList,
    transform: BackendTransformBinding,
    options: ExampleTextOptions,
  ) {
    this.#publish = publish;
    this.#transform = transform;
    this.#state = normalizeTextOptions(options);
    try {
      this.#text = planner.createText(coreTextOptions(this.#state, transform));
    } catch (error) {
      transform.dispose();
      throw error;
    }
  }

  /** Current desired text content. */
  get text(): string {
    return this.#state.text;
  }

  /** Replaces part of the desired text state without publishing. */
  update(update: ExampleTextUpdate): void {
    this.#assertActive();
    if (typeof update !== 'object' || update === null || Array.isArray(update)) {
      throw new TypeError('example text updates must be objects');
    }
    const state = normalizeTextOptions({ ...this.#state, ...update });
    this.#text.update(coreTextOptions(state, this.#transform));
    this.#state = state;
  }

  /** Publishes the owning plan and returns its accepted draw list. */
  publish(): ExampleDrawList {
    this.#assertActive();
    return this.#publish();
  }

  /** Removes this retained text instance from its plan. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#text.dispose();
    this.#transform.dispose();
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('example text is disposed');
  }
}

class ExamplePlanTarget implements PlanTarget {
  readonly delivery = 'borrowed' as const;
  #lastDrawList: ExampleDrawList | undefined;
  readonly #config: ExampleGlyphConfig;
  readonly #binder: GlyphCommandBufferBinder<ExampleBindings>;
  readonly #renderer: GlyphRenderer<ExampleBindings, ExampleDrawList>;
  readonly #rendererAbort = new ExampleAbortController();
  #disposed = false;

  constructor(config: ExampleGlyphConfig, codec: Codec, root: ExampleRootContext) {
    this.#config = config;
    this.#binder = createEngine({ config, codec, root });
    const configured = config.renderer(
      Object.freeze({
        drawRoot: config.schema.drawRoot(root),
        signal: this.#rendererAbort.signal,
      }),
    );
    this.#renderer = Object.freeze({
      prepare: (frame: BorrowedBoundCommandBuffer<ExampleBindings>) => {
        const prepared = configured.prepare(frame);
        let settled = false;
        return Object.freeze({
          result: prepared.result,
          commit: () => {
            if (settled) throw new Error('example renderer preparation is already settled');
            settled = true;
            prepared.commit();
            this.#lastDrawList = prepared.result;
          },
          discard: () => {
            if (settled) return;
            settled = true;
            prepared.discard();
          },
        });
      },
      syncTransforms: (updates: Parameters<typeof configured.syncTransforms>[0]) => configured.syncTransforms(updates),
      dispose: () => configured.dispose(),
    });
  }

  get lastDrawList(): ExampleDrawList {
    if (this.#lastDrawList === undefined) throw new Error('example renderer has not accepted a plan');
    return this.#lastDrawList;
  }

  accept(candidate: PlanCandidate, signal: Parameters<PlanTarget['accept']>[1]) {
    if (this.#disposed) return { accepted: false as const, error: new Error('example plan target is disposed') };
    return applyGlyphPublication(candidate, signal, this.#config.decode, this.#binder, this.#renderer);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#rendererAbort.abort(new Error('example publication boundary disposed'));
    let failure: unknown;
    const attempt = (release: () => void): void => {
      try {
        release();
      } catch (error) {
        failure ??= error;
      }
    };
    attempt(() => this.#renderer.dispose());
    attempt(() => this.#binder.dispose());
    if (failure !== undefined) throw failure;
  }
}

type NormalizedExampleTextOptions = Required<Omit<ExampleTextOptions, 'font' | 'color' | 'opacity'>> &
  Pick<ExampleTextOptions, 'font' | 'color' | 'opacity'>;

function normalizeTextOptions(options: ExampleTextOptions): NormalizedExampleTextOptions {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError('example text options must be an object');
  }
  if (typeof options.text !== 'string') throw new TypeError('example text content must be a string');
  return {
    font: options.font,
    text: options.text,
    fontSize: positiveFinite(options.fontSize ?? 48, 'fontSize'),
    width: positiveFinite(options.width ?? 1024, 'width'),
    height: positiveFinite(options.height ?? 256, 'height'),
    rasterPixelRatio: positiveFinite(options.rasterPixelRatio ?? 1, 'rasterPixelRatio'),
    ...(options.color === undefined ? {} : { color: options.color }),
    ...(options.opacity === undefined ? {} : { opacity: options.opacity }),
  };
}

function coreTextOptions(state: NormalizedExampleTextOptions, transform: BackendTransformBinding) {
  return {
    font: state.font,
    transform,
    text: state.text,
    style: {
      fontSize: state.fontSize,
      ...(state.color === undefined ? {} : { color: state.color }),
      ...(state.opacity === undefined ? {} : { opacity: state.opacity }),
    },
    rasterPixelRatio: state.rasterPixelRatio,
    constraints: {
      width: { mode: 'at-most' as const, size: state.width },
      height: { mode: 'at-most' as const, size: state.height },
    },
    layout: {
      maxLines: EXAMPLE_LIMITS.maxLines,
    },
  };
}

function positiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`example text ${name} must be positive and finite`);
  return value;
}
