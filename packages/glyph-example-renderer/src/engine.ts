import {
  compileTextEngineFrameUpdate,
  compileRasterFont,
  TextEngineHost,
  type FontBindingHandle,
  type FontStackHandle,
  type FlowThreadId,
  type ParagraphId,
  type RegionId,
  type RetainedTextEnginePublication,
  type RuntimeShaper,
  type StyleId,
  type TextEngineFrameLimits,
  type TextEngineParagraphMutation,
  type TextEnginePublication,
  type TextEngineSession,
  type TextEngineStyleMutation,
  type TextEngineTextMutation,
  type TextEngineConstraint,
  type TextEngineRegion,
} from '@pmndrs/glyph/core';
import type { AnyRasterTechnique, LoadedFont } from '@pmndrs/glyph';

import type { ExampleDrawList } from './draw-list.js';
import { readDrawList } from './plan-reader.js';
import { EXAMPLE_POLICY_HANDLE, exampleRenderPolicyBytes } from './policy.js';
import type { ExampleRendererDevice, ExampleRendererResourceInput } from './device.js';

/** The frame limits this host runs under. The engine rejects zero limits outright. */
const EXAMPLE_LIMITS: TextEngineFrameLimits = {
  maxParagraphs: 8,
  maxClusters: 256,
  maxLines: 32,
  maxRegions: 4,
  maxExclusions: 4,
  maxInlineObjects: 4,
  maxSlotsPerBand: 4,
  maxOutputBytes: 128 * 1024,
};

export interface ExampleFrameInput {
  readonly paragraphMutations?: readonly TextEngineParagraphMutation[];
  readonly textMutations?: readonly TextEngineTextMutation[];
  readonly styleMutations?: readonly TextEngineStyleMutation[];
  readonly constraints?: readonly TextEngineConstraint[];
  readonly regions?: readonly TextEngineRegion[];
}

export interface ExampleTextOptions {
  readonly fontStack: FontStackHandle;
  readonly text: string;
  readonly fontSize?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rasterPixelRatio?: number;
  readonly foregroundRgba?: number;
}

export interface ExampleTextUpdate {
  readonly text?: string;
  readonly fontSize?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rasterPixelRatio?: number;
  readonly foregroundRgba?: number;
}

const exampleTextConstruction: unique symbol = Symbol('ExampleText construction');

/**
 * A retained host driving the engine through `@pmndrs/glyph/core` alone.
 *
 * `render` is the retention protocol, executed in order on every frame:
 *
 * ```ts
 * const publication = session.update(request); // borrow, valid until the next call
 * session.assertLive(publication);             // cheap liveness gate before decoding
 * const owned = session.retain(publication);   // one contiguous owned copy
 * readDrawList(owned);                         // decode views over owned bytes only
 * ```
 *
 * Engine acceptance advances the engine revision. Device acceptance advances the consumed
 * plan revision and acknowledgment; rejection leaves the last rendered state authoritative.
 */
export class ExampleTextEngine {
  readonly #host: TextEngineHost;
  readonly #device: ExampleRendererDevice | undefined;
  #nextBindingOrdinal = 1;
  #nextStackOrdinal = 1;
  #nextTextOrdinal = 1;
  readonly #freeTextOrdinals: number[] = [];
  #session: TextEngineSession | undefined;
  #rendering = false;
  #disposed = false;

  constructor(shaper: RuntimeShaper, device?: ExampleRendererDevice) {
    this.#host = new TextEngineHost(shaper);
    this.#device = device;
    try {
      this.#host.registerPolicy(EXAMPLE_POLICY_HANDLE, exampleRenderPolicyBytes(this.#host.wireIdentities));
    } catch (error) {
      try {
        this.#host.dispose();
      } catch (disposeError) {
        const failure = new AggregateError(
          [error, disposeError],
          'example engine construction and teardown both failed',
          {
            cause: error,
          },
        );
        throw failure;
      }
      throw error;
    }
  }

  /** Compile and register one loaded font through the portable raster program. */
  registerFont(font: LoadedFont<AnyRasterTechnique>): FontBindingHandle {
    this.#assertActive();
    if (this.#rendering)
      throw new Error('example engine cannot register a font while a frame submission is in progress');
    const shader = this.#device?.shader;
    if (shader !== undefined && shader.variant.techniqueId !== font.technique.id) {
      throw new TypeError(
        `example renderer shader "${shader.variant.techniqueId}" cannot render "${font.technique.id}"`,
      );
    }
    const compiled = compileRasterFont(font, this.#host.wireIdentities);
    if (compiled === undefined)
      throw new TypeError(`no portable raster plan program is registered for "${font.technique.id}"`);
    const bindingHandle = this.#host.id('font-binding', `glyph-example-renderer/${this.#nextBindingOrdinal}`);
    const requiredNames =
      shader === undefined ? [...compiled.declaredResources.keys()] : Object.keys(shader.variant.resources);
    const resources: ExampleRendererResourceInput[] = [];
    for (const name of requiredNames) {
      const keys = compiled.declaredResources.get(name);
      if (keys === undefined || keys.length === 0) throw new Error(`compiled font omitted declared resource "${name}"`);
      for (const key of keys) {
        const resource = compiled.resources.get(key);
        if (resource === undefined) throw new Error(`compiled font omitted declared resource "${name}"`);
        resources.push({ id: this.#host.wireIdentities.resourceId(key), generation: 1, name, resource });
      }
    }
    const pending = this.#device?.prepareResources(resources);
    try {
      this.#host.registerFontBinding(bindingHandle, font.font.handle, compiled.binding);
      try {
        pending?.commit();
      } catch (commitError) {
        try {
          this.#host.disposeFontBinding(bindingHandle);
        } catch (disposeError) {
          throw new AggregateError(
            [commitError, disposeError],
            'example renderer resource commit and font-binding rollback both failed',
            { cause: commitError },
          );
        }
        throw commitError;
      }
    } catch (error) {
      pending?.discard();
      throw error;
    }
    this.#nextBindingOrdinal += 1;
    return bindingHandle;
  }

  /** The live session, for hosts that compose raw protocol steps themselves. */
  get session(): TextEngineSession {
    this.#assertActive();
    if (this.#session === undefined) throw new Error('example engine has no open frame session');
    return this.#session;
  }

  /** Register a selectable font stack and return the handle later text options reference. */
  registerFontStack(fontHandles: readonly FontBindingHandle[]): FontStackHandle {
    this.#assertActive();
    const handle = this.#host.id('font-stack', `glyph-example-renderer/${this.#nextStackOrdinal}`);
    this.#host.registerFontStack(handle, fontHandles);
    this.#nextStackOrdinal += 1;
    return handle;
  }

  openSession(): TextEngineSession {
    this.#assertActive();
    if (this.#session !== undefined) throw new Error('example engine already has an open frame session');
    const handle = this.#host.id('session', 'glyph-example-renderer/main');
    this.#session = this.#host.createSession({ handle, requestCapacity: 4096, resultCapacity: 128 * 1024 });
    return this.#session;
  }

  /** Creates one retained application text after its font stack and session exist. */
  createText(options: ExampleTextOptions): ExampleText {
    void this.session;
    const recycledOrdinal = this.#freeTextOrdinals.pop();
    const ordinal = recycledOrdinal ?? this.#nextTextOrdinal++;
    try {
      return new ExampleText(
        exampleTextConstruction,
        this.#host.id,
        (input, accepted) => this.#startRender(input, accepted),
        () => this.#freeTextOrdinals.push(ordinal),
        ordinal,
        options,
      );
    } catch (error) {
      this.#freeTextOrdinals.push(ordinal);
      throw error;
    }
  }

  /** Serializes one frame request, carrying the acknowledged generation automatically. */
  frameRequest(input: ExampleFrameInput): Uint8Array {
    const session = this.session;
    return compileTextEngineFrameUpdate({
      sessionId: session.handle,
      policyHandle: EXAMPLE_POLICY_HANDLE,
      expectedEngineRevision: this.#engineRevision,
      consumedPlanRevision: this.#planRevision,
      acknowledgedPublicationGeneration: this.#acknowledgedPublicationGeneration,
      limits: EXAMPLE_LIMITS,
      ...(input.paragraphMutations === undefined ? {} : { paragraphMutations: input.paragraphMutations }),
      ...(input.textMutations === undefined ? {} : { textMutations: input.textMutations }),
      ...(input.styleMutations === undefined ? {} : { styleMutations: input.styleMutations }),
      ...(input.constraints === undefined ? {} : { constraints: input.constraints }),
      ...(input.regions === undefined ? {} : { regions: input.regions }),
    });
  }

  /** Runs one real frame and returns its plan, retained into host-owned memory. */
  render(input: ExampleFrameInput): Promise<ExampleDrawList> {
    return this.#startRender(input);
  }

  #startRender(input: ExampleFrameInput, engineAccepted?: () => void): Promise<ExampleDrawList> {
    this.#assertActive();
    if (this.#rendering) throw new Error('example engine already has a frame submission in progress');
    this.#rendering = true;
    return this.#render(input, engineAccepted).finally(() => {
      this.#rendering = false;
    });
  }

  async #render(input: ExampleFrameInput, engineAccepted?: () => void): Promise<ExampleDrawList> {
    const device = this.#device;
    const borrowed = this.session.update(this.frameRequest(input));
    this.#engineRevision = borrowed.engineRevision;
    engineAccepted?.();
    const publication = this.#copyPublication(borrowed);
    const list = readDrawList(publication);
    const pending = device?.prepareSubmission(list);
    try {
      const accepted = await pending?.commit();
      if (accepted === false) throw new Error('example renderer rejected a superseded frame submission');
    } catch (error) {
      pending?.discard();
      throw error;
    }
    this.#planRevision = list.planRevision;
    this.#acknowledgedPublicationGeneration = list.publicationGeneration;
    return list;
  }

  #acknowledgedPublicationGeneration = 0;
  #engineRevision = 0;
  #planRevision = 0;

  /** Copy a raw borrow before any device operation can invalidate Wasm memory. */
  #copyPublication(publication: TextEnginePublication): RetainedTextEnginePublication {
    const session = this.session;
    session.assertLive(publication);
    return session.retain(publication);
  }

  dispose(): void {
    if (this.#disposed) return;
    if (this.#rendering) throw new Error('example engine cannot dispose while a frame submission is in progress');
    this.#disposed = true;
    try {
      this.#host.dispose();
    } finally {
      this.#session = undefined;
    }
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('example engine is disposed');
  }
}

/** A small retained text façade that emits validated frame mutations only when its desired state changes. */
export class ExampleText {
  readonly #renderFrame: (input: ExampleFrameInput, engineAccepted: () => void) => Promise<ExampleDrawList>;
  readonly #releaseOrdinal: () => void;
  readonly #paragraphId: ParagraphId;
  readonly #styleId: StyleId;
  readonly #flowThreadId: FlowThreadId;
  readonly #regionId: RegionId;
  readonly #order: number;
  readonly #transformIndex: number;
  #state: Required<Omit<ExampleTextOptions, 'fontStack'>> & Pick<ExampleTextOptions, 'fontStack'>;
  #publishedText = '';
  #geometryRevision = 1;
  #created = false;
  #dirty = true;
  #disposed = false;

  constructor(
    construction: typeof exampleTextConstruction,
    id: TextEngineHost['id'],
    renderFrame: (input: ExampleFrameInput, engineAccepted: () => void) => Promise<ExampleDrawList>,
    releaseOrdinal: () => void,
    ordinal: number,
    options: ExampleTextOptions,
  ) {
    if (construction !== exampleTextConstruction) throw new TypeError('create example text through its engine');
    this.#renderFrame = renderFrame;
    this.#releaseOrdinal = releaseOrdinal;
    this.#order = ordinal - 1;
    this.#transformIndex = ordinal;
    const namespace = `glyph-example-renderer/text/${ordinal}`;
    this.#paragraphId = id('paragraph', namespace);
    this.#styleId = id('style', `${namespace}/style`);
    this.#flowThreadId = id('flow-thread', `${namespace}/flow`);
    this.#regionId = id('region', `${namespace}/region`);
    this.#state = normalizeTextOptions(options);
  }

  get text(): string {
    return this.#state.text;
  }

  update(update: ExampleTextUpdate): void {
    this.#assertLive();
    if (typeof update !== 'object' || update === null || Array.isArray(update)) {
      throw new TypeError('example text updates must be objects');
    }
    const next = normalizeTextOptions({ ...this.#state, ...update });
    if (sameTextState(this.#state, next)) return;
    if (next.width !== this.#state.width || next.height !== this.#state.height) this.#geometryRevision += 1;
    this.#state = next;
    this.#dirty = true;
  }

  render(): Promise<ExampleDrawList> {
    this.#assertLive();
    if (!this.#dirty) return this.#renderFrame({}, () => {});
    const state = this.#state;
    return this.#renderFrame(
      {
        ...(!this.#created
          ? { paragraphMutations: [{ opcode: 'upsert' as const, paragraphId: this.#paragraphId, order: this.#order }] }
          : {}),
        textMutations: [
          {
            paragraphId: this.#paragraphId,
            start: 0,
            deleteCount: this.#publishedText.length,
            insert: state.text,
          },
        ],
        styleMutations: [
          {
            opcode: 'upsert',
            paragraphId: this.#paragraphId,
            styleId: this.#styleId,
            cascadeOrder: 0,
            start: 0,
            end: state.text.length,
            root: true,
            value: {
              fontStackHandle: state.fontStack,
              fontSize: state.fontSize,
              rasterPixelRatio: state.rasterPixelRatio,
              foregroundRgba: state.foregroundRgba,
            },
          },
        ],
        constraints: [this.#constraint()],
        regions: [this.#region()],
      },
      () => {
        this.#created = true;
        this.#publishedText = state.text;
        this.#dirty = false;
      },
    );
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    if (this.#created) {
      await this.#renderFrame({ paragraphMutations: [{ opcode: 'remove', paragraphId: this.#paragraphId }] }, () => {
        this.#acceptDisposal();
      });
      return;
    }
    this.#acceptDisposal();
  }

  #constraint(): TextEngineConstraint {
    return {
      paragraphId: this.#paragraphId,
      flowThreadId: this.#flowThreadId,
      geometryRevision: this.#geometryRevision,
      width: this.#state.width,
      height: this.#state.height,
      viewportBlockStart: 0,
      viewportBlockEnd: this.#state.height,
      resumeBlockOffset: 0,
      maxLines: EXAMPLE_LIMITS.maxLines,
      regionStart: 0,
      resumeCluster: 0,
      regionCount: 1,
      resumeRegion: 0,
      widthMode: 'at-most',
      heightMode: 'at-most',
      wrap: 'word',
      align: 'start',
      overflow: 'visible',
      blockAlign: 'start',
    };
  }

  #region(): TextEngineRegion {
    return {
      id: this.#regionId,
      geometryRevision: this.#geometryRevision,
      transformIndex: this.#transformIndex,
      shape: 'rectangle',
      exclusionStart: 0,
      exclusionCount: 0,
      writingMode: 'horizontal-tb',
      textOrientation: 'mixed',
      inlineStart: 0,
      blockStart: 0,
      inlineEnd: this.#state.width,
      blockEnd: this.#state.height,
      clipInlineStart: 0,
      clipBlockStart: 0,
      clipInlineEnd: this.#state.width,
      clipBlockEnd: this.#state.height,
    };
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error('example text is disposed');
  }

  #acceptDisposal(): void {
    this.#disposed = true;
    this.#releaseOrdinal();
  }
}

function normalizeTextOptions(
  options: ExampleTextOptions,
): Required<Omit<ExampleTextOptions, 'fontStack'>> & Pick<ExampleTextOptions, 'fontStack'> {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError('example text options must be an object');
  }
  if (typeof options.text !== 'string') throw new TypeError('example text content must be a string');
  return {
    fontStack: options.fontStack,
    text: options.text,
    fontSize: positiveFinite(options.fontSize ?? 48, 'fontSize'),
    width: positiveFinite(options.width ?? 1024, 'width'),
    height: positiveFinite(options.height ?? 256, 'height'),
    rasterPixelRatio: positiveFinite(options.rasterPixelRatio ?? 1, 'rasterPixelRatio'),
    foregroundRgba: unsignedU32(options.foregroundRgba ?? 0xffff_ffff, 'foregroundRgba'),
  };
}

function sameTextState(
  left: Required<Omit<ExampleTextOptions, 'fontStack'>> & Pick<ExampleTextOptions, 'fontStack'>,
  right: Required<Omit<ExampleTextOptions, 'fontStack'>> & Pick<ExampleTextOptions, 'fontStack'>,
): boolean {
  return (
    left.fontStack === right.fontStack &&
    left.text === right.text &&
    left.fontSize === right.fontSize &&
    left.width === right.width &&
    left.height === right.height &&
    left.rasterPixelRatio === right.rasterPixelRatio &&
    left.foregroundRgba === right.foregroundRgba
  );
}

function positiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`example text ${name} must be positive and finite`);
  return value;
}

function unsignedU32(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`example text ${name} must be an unsigned 32-bit integer`);
  }
  return value;
}
