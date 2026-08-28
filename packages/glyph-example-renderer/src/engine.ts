import type { AnyRasterTechnique, ColorInput, Font, FontStack, GlyphPaintInput } from '@pmndrs/glyph';
import {
  type HostFontBinding,
  type HostFontStackBinding,
  type HostPolicy,
  type PlanCandidate,
  type PlanTarget,
  type SynchronousTextEngineSession,
  type TextEngineText,
  type TextRuntime,
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
  readonly font: HostFontStackBinding;
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
  readonly font?: HostFontStackBinding;
  readonly text?: string;
  readonly fontSize?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rasterPixelRatio?: number;
  readonly color?: ColorInput;
  readonly opacity?: number;
}

/** A complete third-party integration using only root assets and the public `/core` host contract. */
export class ExampleTextEngine {
  readonly #host;
  readonly #policy: HostPolicy;
  readonly #target: ExamplePlanTarget;
  #session: SynchronousTextEngineSession | undefined;
  #disposed = false;

  constructor(runtime: TextRuntime, device?: ExampleRendererDevice) {
    this.#host = runtime.createTextEngineHost({ integration: '@pmndrs/glyph-example-renderer' });
    this.#target = new ExamplePlanTarget(device);
    try {
      this.#policy = this.#host.installPolicy(exampleRenderPolicyDescriptor);
    } catch (error) {
      this.#host.dispose();
      throw error;
    }
  }

  /** Binds one immutable font to this renderer host. */
  bindFont<Technique extends AnyRasterTechnique>(font: Font<Technique>): HostFontBinding<Technique> {
    this.#assertActive();
    const shader = this.#target.shader;
    if (shader !== undefined && shader.variant.techniqueId !== font.technique.id) {
      throw new TypeError(
        `example renderer shader "${shader.variant.techniqueId}" cannot render "${font.technique.id}"`,
      );
    }
    return this.#host.bindFont(font);
  }

  /** Binds an ordered immutable font stack to this renderer host. */
  bindFontStack<Technique extends AnyRasterTechnique>(
    stack: FontStack<Technique, Font<Technique>>,
  ): HostFontStackBinding {
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
    return this.#host.bindFontStack(stack);
  }

  /** Opens the engine's single retained example session. */
  openSession(): SynchronousTextEngineSession {
    this.#assertActive();
    if (this.#session !== undefined) throw new Error('example engine already has an open text session');
    this.#session = this.#host.createSession({
      policy: this.#policy,
      capabilitySet: exampleCapabilitySet,
      target: () => this.#target,
      limits: EXAMPLE_LIMITS,
      requestCapacity: 64 * 1024,
      resultCapacity: 256 * 1024,
      textCapacity: 16 * 1024,
    });
    return this.#session;
  }

  /** Creates one retained text instance in the open session. */
  createText(options: ExampleTextOptions): ExampleText {
    const session = this.#requireSession();
    return new ExampleText(session, () => this.publish(), options);
  }

  /** Publishes current desired state and returns the accepted decoded draw list. */
  publish(): ExampleDrawList {
    const result = this.#requireSession().publish();
    if (!result.accepted) throw result.error;
    return this.#target.lastDrawList;
  }

  /** Disposes the host, session, target, and retained payload leases. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#host.dispose();
    this.#session = undefined;
  }

  #requireSession(): SynchronousTextEngineSession {
    this.#assertActive();
    return this.#session ?? this.openSession();
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('example engine is disposed');
  }
}

/** One retained text instance owned by an {@link ExampleTextEngine} session. */
export class ExampleText {
  readonly #text: TextEngineText;
  readonly #publish: () => ExampleDrawList;
  #state: NormalizedExampleTextOptions;
  #disposed = false;

  constructor(session: SynchronousTextEngineSession, publish: () => ExampleDrawList, options: ExampleTextOptions) {
    this.#publish = publish;
    this.#state = normalizeTextOptions(options);
    this.#text = session.createText(coreTextOptions(this.#state));
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

  /** Publishes the owning session and returns its accepted draw list. */
  publish(): ExampleDrawList {
    this.#assertActive();
    return this.#publish();
  }

  /** Removes this retained text instance from its session. */
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
  readonly #device: ExampleRendererDevice | undefined;
  readonly #payloads = new Map<number, ReturnType<PlanCandidate['acquirePayload']>>();
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

  accept(candidate: PlanCandidate) {
    if (this.#disposed) return { accepted: false as const, error: new Error('example plan target is disposed') };
    const list = readCandidate(candidate);
    const device = this.#device;
    if (device === undefined) {
      this.#lastDrawList = list;
      return { accepted: true as const };
    }

    const resources: ExampleRendererResourceInput[] = [];
    const acquired: Array<ReturnType<PlanCandidate['acquirePayload']>> = [];
    const retained = new Set<ReturnType<PlanCandidate['acquirePayload']>>();
    try {
      for (const record of list.resourceRecords) {
        if (record.referenceId === 0 || this.#payloads.has(record.referenceId)) continue;
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
      return { accepted: true as const };
    } catch (error) {
      for (const payload of acquired) if (!retained.has(payload)) payload.dispose();
      return { accepted: false as const, error };
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const payload of this.#payloads.values()) payload.dispose();
    this.#payloads.clear();
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
