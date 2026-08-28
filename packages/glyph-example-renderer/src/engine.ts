import type { AnyRasterTechnique, ColorInput, Font, FontStack, GlyphPaintInput } from '@pmndrs/glyph';
import {
  type BackendFontBinding,
  type BackendFontStackBinding,
  type BackendPolicy,
  type PlanCandidate,
  type PlanTarget,
  type PlanTargetControl,
  type RenderPlanResourceId,
  type ResourceHandle,
  type SynchronousRetainedPlan,
  type RetainedText,
  type GlyphEngine,
} from '@pmndrs/glyph/core';

import type { ExampleDrawList } from './draw-list.js';
import type { ExampleRendererDevice, ExampleRendererResourceInput } from './device.js';
import { readCandidate } from './plan-reader.js';
import { exampleCapabilitySet, exampleRenderPolicyDescriptor } from './policy.js';

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
  #retainedPlan: SynchronousRetainedPlan | undefined;
  #disposed = false;

  constructor(glyphEngine: GlyphEngine, device?: ExampleRendererDevice) {
    if (device !== undefined) assertExampleRendererDevice(device);
    this.#backend = glyphEngine.createBackend({ integration: '@pmndrs/glyph-example-renderer' });
    this.#target = new ExamplePlanTarget(device);
    try {
      this.#policy = this.#backend.installPolicy(exampleRenderPolicyDescriptor);
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

  /** Opens the engine's single retained example plan. */
  openRetainedPlan(): SynchronousRetainedPlan {
    this.#assertActive();
    if (this.#retainedPlan !== undefined) throw new Error('example engine already has an open retained plan');
    this.#retainedPlan = this.#backend.createRetainedPlan({
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
    return this.#retainedPlan;
  }

  /** Creates one retained text instance in the open plan. */
  createText(options: ExampleTextOptions): ExampleText {
    const retainedPlan = this.#requireRetainedPlan();
    return new ExampleText(retainedPlan, () => this.publish(), options);
  }

  /** Publishes current desired state and returns the accepted decoded draw list. */
  publish(): ExampleDrawList {
    const result = this.#requireRetainedPlan().publish();
    if (!result.accepted) throw result.error;
    return this.#target.lastDrawList;
  }

  /** Installs a caller-owned rebuilt device; the next publication is a complete checkpoint. */
  replaceDevice(device: ExampleRendererDevice): void {
    this.#assertActive();
    assertExampleRendererDevice(device);
    this.#target.replaceDevice(device);
  }

  /** Disposes the backend, plan, target, and retained payload leases. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#backend.dispose();
    this.#retainedPlan = undefined;
  }

  #requireRetainedPlan(): SynchronousRetainedPlan {
    this.#assertActive();
    return this.#retainedPlan ?? this.openRetainedPlan();
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

  constructor(retainedPlan: SynchronousRetainedPlan, publish: () => ExampleDrawList, options: ExampleTextOptions) {
    this.#publish = publish;
    this.#state = normalizeTextOptions(options);
    this.#text = retainedPlan.createText(coreTextOptions(this.#state));
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
  #disposed = false;

  constructor(device: ExampleRendererDevice | undefined) {
    this.#device = device;
  }

  get shader(): ExampleRendererDevice['shader'] | undefined {
    return this.#device?.shader;
  }

  get lastDrawList(): ExampleDrawList {
    if (this.#lastDrawList === undefined) throw new Error('example renderer has not accepted a plan');
    return this.#lastDrawList;
  }

  attachControl(control: PlanTargetControl): void {
    if (this.#control !== undefined) throw new Error('example plan target already has retained-plan control');
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

  accept(candidate: PlanCandidate) {
    if (this.#disposed) return { accepted: false as const, error: new Error('example plan target is disposed') };
    const list = readCandidate(candidate);
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
    let failure: unknown;
    const attempt = (release: () => void): void => {
      try {
        release();
      } catch (error) {
        failure ??= error;
      }
    };
    const referenceIds = [...this.#payloads.keys()];
    if (referenceIds.length !== 0) attempt(() => this.#device?.releaseResources(referenceIds));
    for (const payload of this.#payloads.values()) attempt(() => payload.dispose());
    this.#payloads.clear();
    this.#resourcePayloads.clear();
    this.#control = undefined;
    if (failure !== undefined) throw failure;
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
  const paint: GlyphPaintInput | undefined =
    state.color === undefined && state.opacity === undefined
      ? undefined
      : {
          ...(state.color === undefined ? {} : { color: state.color }),
          ...(state.opacity === undefined ? {} : { opacity: state.opacity }),
        };
  return {
    font: state.font,
    text: state.text,
    style: { fontSize: state.fontSize },
    ...(paint === undefined ? {} : { paint }),
    rasterPixelRatio: state.rasterPixelRatio,
    contentBox: {
      width: { mode: 'at-most' as const, size: state.width },
      height: { mode: 'at-most' as const, size: state.height },
      maxLines: EXAMPLE_LIMITS.maxLines,
    },
  };
}

function positiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`example text ${name} must be positive and finite`);
  return value;
}
