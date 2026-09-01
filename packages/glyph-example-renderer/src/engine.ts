import type { AnyRasterTechnique, ColorInput, Font, FontStack } from '@pmndrs/glyph';
import {
  type BackendFontBinding,
  type BackendFontStackBinding,
  type BackendPolicy,
  type PlanCandidate,
  type PlanTarget,
  type PlanTargetControl,
  type RenderPlanResourceId,
  type ResourceHandle,
  type RenderPlanner,
  type RetainedText,
  type GlyphEngine,
  applyGlyphPublication,
  type BorrowedBoundCommandBuffer,
  type GlyphRenderer,
} from '@pmndrs/glyph/core';

import type { ExampleDrawList } from './draw-list.js';
import type { ExampleRendererDevice, ExampleRendererResourceInput } from './device.js';
import { readCandidate } from './plan-reader.js';
import { exampleCapabilitySet, exampleRenderPolicyDescriptor } from './policy.js';
import { ExampleCommandBufferBinder, exampleFrameState } from './command-buffer.js';
import type { ExampleBindings, ExampleGlyphConfig, ExampleRendererContext } from './config.js';

const exampleDrawRoot = Object.freeze({}) as ExampleBindings['transform'];
type ExampleAbortSignal = ExampleRendererContext['signal'];
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

  constructor(glyphEngine: GlyphEngine, device?: ExampleRendererDevice, config?: ExampleGlyphConfig) {
    if (device !== undefined) assertExampleRendererDevice(device);
    this.#backend = glyphEngine.createBackend({ integration: '@pmndrs/glyph-example-renderer' });
    this.#target = new ExamplePlanTarget(device, config);
    try {
      this.#policy = this.#backend.installPolicy(
        (ids) =>
          config?.encode({ integration: '@pmndrs/glyph-example-renderer', ids }).descriptor ??
          exampleRenderPolicyDescriptor(ids),
      );
    } catch (error) {
      this.#backend.dispose();
      throw error;
    }
  }

  /** Binds one immutable font to this renderer backend. */
  bindFont<Technique extends AnyRasterTechnique>(font: Font<Technique>): BackendFontBinding<Technique> {
    this.#assertActive();
    const shader = this.#target.shader;
    if (shader !== undefined && shader.variant.techniqueId !== font.technique.id) {
      throw new TypeError(
        `example renderer shader "${shader.variant.techniqueId}" cannot render "${font.technique.id}"`,
      );
    }
    return this.#backend.bindFont(font);
  }

  /** Binds an ordered immutable font stack to this renderer backend. */
  bindFontStack<Technique extends AnyRasterTechnique>(
    stack: FontStack<Technique, Font<Technique>>,
  ): BackendFontStackBinding {
    this.#assertActive();
    const shader = this.#target.shader;
    if (shader !== undefined) {
      for (const font of stack.fonts) {
        if (font.technique.id !== shader.variant.techniqueId) {
          throw new TypeError(
            `example renderer shader "${shader.variant.techniqueId}" cannot render "${font.technique.id}"`,
          );
        }
      }
    }
    return this.#backend.bindFontStack(stack);
  }

  /** Opens the example engine's single render planner. */
  openPlanner(): RenderPlanner {
    this.#assertActive();
    if (this.#planner !== undefined) throw new Error('example engine already has an open render planner');
    this.#planner = this.#backend.createPlanner({
      policy: this.#policy,
      capabilitySet: exampleCapabilitySet,
      target: (control) => {
        this.#target.attachControl(control);
        return this.#target;
      },
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
    return new ExampleText(planner, () => this.publish(), options);
  }

  /** Publishes current desired state and returns the accepted decoded draw list. */
  publish(): ExampleDrawList {
    const result = this.#requirePlanner().publish();
    if (!result.accepted) throw result.error;
    return this.#target.lastDrawList;
  }

  /** Installs a caller-owned rebuilt device; the next publication is a complete checkpoint. */
  replaceDevice(device: ExampleRendererDevice): void {
    this.#assertActive();
    assertExampleRendererDevice(device);
    this.#target.replaceDevice(device);
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
  #state: NormalizedExampleTextOptions;
  #disposed = false;

  constructor(planner: RenderPlanner, publish: () => ExampleDrawList, options: ExampleTextOptions) {
    this.#publish = publish;
    this.#state = normalizeTextOptions(options);
    this.#text = planner.createText(coreTextOptions(this.#state));
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
    this.#text.update(coreTextOptions(state));
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
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('example text is disposed');
  }
}

class ExamplePlanTarget implements PlanTarget {
  readonly delivery = 'borrowed' as const;
  #device: ExampleRendererDevice | undefined;
  #control: PlanTargetControl | undefined;
  readonly #payloads = new Map<ResourceHandle, ReturnType<PlanCandidate['acquirePayload']>>();
  readonly #resourcePayloads = new Map<
    RenderPlanResourceId,
    Readonly<{ generation: number; referenceId: ResourceHandle }>
  >();
  #lastDrawList: ExampleDrawList | undefined;
  readonly #config: ExampleGlyphConfig | undefined;
  readonly #binder: ExampleCommandBufferBinder | undefined;
  readonly #renderer: GlyphRenderer<ExampleBindings, void> | undefined;
  readonly #rendererAbort = new ExampleAbortController();
  #disposed = false;

  constructor(device: ExampleRendererDevice | undefined, config: ExampleGlyphConfig | undefined) {
    this.#device = device;
    this.#config = config;
    if (config !== undefined) {
      this.#binder = new ExampleCommandBufferBinder(config);
      const defaultRenderer: GlyphRenderer<ExampleBindings, void> = Object.freeze({
        prepare: (frame: BorrowedBoundCommandBuffer<ExampleBindings>) => this.#prepareBoundFrame(frame),
        syncTransforms: () => undefined,
        dispose: () => undefined,
      });
      const context: ExampleRendererContext = Object.freeze({
        drawRoot: exampleDrawRoot,
        signal: this.#rendererAbort.signal,
        defaultRenderer,
      });
      this.#renderer = config.renderer(context);
    }
  }

  get shader(): ExampleRendererDevice['shader'] | undefined {
    return this.#device?.shader;
  }

  get lastDrawList(): ExampleDrawList {
    if (this.#lastDrawList === undefined) throw new Error('example renderer has not accepted a plan');
    return this.#lastDrawList;
  }

  attachControl(control: PlanTargetControl): void {
    if (this.#control !== undefined) throw new Error('example plan target already has planner control');
    this.#control = control;
  }

  replaceDevice(device: ExampleRendererDevice): void {
    if (this.#disposed) throw new Error('example plan target is disposed');
    const current = this.#device;
    if (current === device) return;
    if (current !== undefined && !sameShaderSelection(current.shader, device.shader)) {
      throw new TypeError('replacement device must select the same renderer shader');
    }
    this.#control?.requestCheckpoint();
    for (const payload of this.#payloads.values()) payload.dispose();
    this.#payloads.clear();
    this.#resourcePayloads.clear();
    this.#lastDrawList = undefined;
    this.#device = device;
  }

  accept(candidate: PlanCandidate, signal: Parameters<PlanTarget['accept']>[1]) {
    if (this.#disposed) return { accepted: false as const, error: new Error('example plan target is disposed') };
    if (this.#config !== undefined && this.#binder !== undefined && this.#renderer !== undefined) {
      return applyGlyphPublication(candidate, signal, this.#config.decode, this.#binder, this.#renderer);
    }
    return this.#acceptCandidate(candidate, readCandidate(candidate));
  }

  #acceptCandidate(candidate: PlanCandidate, list: ExampleDrawList) {
    const device = this.#device;
    if (device === undefined) {
      this.#lastDrawList = list;
      return { accepted: true as const };
    }

    const resources: ExampleRendererResourceInput[] = [];
    const nextResourcePayloads = new Map(this.#resourcePayloads);
    const acquired: Array<ReturnType<PlanCandidate['acquirePayload']>> = [];
    const retained = new Set<ReturnType<PlanCandidate['acquirePayload']>>();
    try {
      for (const record of list.resourceRecords) {
        if (record.referenceId === 0) continue;
        nextResourcePayloads.set(record.id, { generation: record.generation, referenceId: record.referenceId });
        if (this.#payloads.has(record.referenceId)) continue;
        const payload = candidate.acquirePayload(record.referenceId);
        if (payload.techniqueId !== device.shader.variant.techniqueId) {
          payload.dispose();
          throw new TypeError(`plan payload technique "${payload.techniqueId}" does not match the selected shader`);
        }
        acquired.push(payload);
        resources.push({
          id: record.referenceId,
          generation: record.generation,
          name: payload.resourceName,
          resource: payload.payload,
        });
      }
      for (const retirement of list.retirements) {
        if (retirement.kind !== 'resource') continue;
        const resourceId = retirement.id as RenderPlanResourceId;
        const current = nextResourcePayloads.get(resourceId);
        if (current?.generation === retirement.generation) nextResourcePayloads.delete(resourceId);
      }
      const pendingResources = device.prepareResources(resources);
      try {
        pendingResources.commit();
      } catch (error) {
        pendingResources.discard();
        throw error;
      }
      for (const [index, payload] of acquired.entries()) {
        this.#payloads.set(resources[index]!.id, payload);
        retained.add(payload);
      }

      const pending = device.prepareSubmission(list);
      try {
        if (!pending.commit()) {
          pending.discard();
          return { accepted: false as const, error: new Error('example renderer rejected a superseded plan') };
        }
      } catch (error) {
        pending.discard();
        throw error;
      }
      this.#lastDrawList = list;
      this.#resourcePayloads.clear();
      for (const [id, payload] of nextResourcePayloads) this.#resourcePayloads.set(id, payload);
      const activeReferences = new Set([...nextResourcePayloads.values()].map(({ referenceId }) => referenceId));
      const retiredPayloads: Array<[ResourceHandle, ReturnType<PlanCandidate['acquirePayload']>]> = [];
      for (const [referenceId, payload] of this.#payloads) {
        if (activeReferences.has(referenceId)) continue;
        retiredPayloads.push([referenceId, payload]);
      }
      device.releaseResources(retiredPayloads.map(([referenceId]) => referenceId));
      for (const [referenceId, payload] of retiredPayloads) {
        payload.dispose();
        this.#payloads.delete(referenceId);
      }
      return { accepted: true as const };
    } catch (error) {
      for (const payload of acquired) if (!retained.has(payload)) payload.dispose();
      return { accepted: false as const, error };
    }
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
    const referenceIds = [...this.#payloads.keys()];
    attempt(() => this.#renderer?.dispose());
    attempt(() => this.#binder?.dispose());
    if (referenceIds.length !== 0) attempt(() => this.#device?.releaseResources(referenceIds));
    for (const payload of this.#payloads.values()) attempt(() => payload.dispose());
    this.#payloads.clear();
    this.#resourcePayloads.clear();
    this.#control = undefined;
    if (failure !== undefined) throw failure;
  }

  #prepareBoundFrame(frame: BorrowedBoundCommandBuffer<ExampleBindings>) {
    const state = exampleFrameState(frame);
    let settled = false;
    return Object.freeze({
      result: undefined,
      commit: () => {
        if (settled) throw new Error('example renderer preparation is already settled');
        settled = true;
        const result = this.#acceptCandidate(state.candidate, state.list);
        if (!result.accepted) throw result.error;
      },
      discard: () => {
        settled = true;
      },
    });
  }
}

function sameShaderSelection(left: ExampleRendererDevice['shader'], right: ExampleRendererDevice['shader']): boolean {
  return (
    left.variant.techniqueId === right.variant.techniqueId &&
    left.variant.language === right.variant.language &&
    left.programNamespace === right.programNamespace &&
    left.programName === right.programName &&
    left.programVariant === right.programVariant
  );
}

function assertExampleRendererDevice(value: unknown): asserts value is ExampleRendererDevice {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('example renderer device must be an object');
  }
  const device = value as Partial<ExampleRendererDevice>;
  const shader = device.shader;
  if (
    typeof shader !== 'object' ||
    shader === null ||
    typeof shader.variant !== 'object' ||
    shader.variant === null ||
    typeof shader.variant.techniqueId !== 'string' ||
    typeof shader.variant.language !== 'string'
  ) {
    throw new TypeError('example renderer device must select a shader');
  }
  if (
    typeof device.prepareResources !== 'function' ||
    typeof device.prepareSubmission !== 'function' ||
    typeof device.releaseResources !== 'function'
  ) {
    throw new TypeError('example renderer device must implement resource and submission methods');
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

function coreTextOptions(state: NormalizedExampleTextOptions) {
  return {
    font: state.font,
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
