import {
  compileTextEngineFrameUpdate,
  compileRasterFont,
  TextEngineHost,
  type RetainedTextEnginePublication,
  type RuntimeShaper,
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
import { EXAMPLE_CAPABILITY_SET, EXAMPLE_POLICY_HANDLE, exampleRenderPolicyBytes } from './policy.js';
import type { ExampleRendererDevice, ExampleRendererResourceInput } from './device.js';

const FIRST_EXAMPLE_BINDING_HANDLE = 100;

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
  #nextBindingHandle = FIRST_EXAMPLE_BINDING_HANDLE;
  #session: TextEngineSession | undefined;

  constructor(shaper: RuntimeShaper, device?: ExampleRendererDevice) {
    this.#host = new TextEngineHost(shaper);
    this.#device = device;
    this.#host.registerPolicy(EXAMPLE_POLICY_HANDLE, exampleRenderPolicyBytes(this.#host.wireIdentities));
  }

  /** Compile and register one loaded font through the portable raster program. */
  registerFont(font: LoadedFont<AnyRasterTechnique>): number {
    const shader = this.#device?.shader;
    if (shader !== undefined && shader.variant.techniqueId !== font.technique.id) {
      throw new TypeError(
        `example renderer shader "${shader.variant.techniqueId}" cannot render "${font.technique.id}"`,
      );
    }
    const compiled = compileRasterFont(font, this.#host.wireIdentities);
    if (compiled === undefined)
      throw new TypeError(`no portable raster plan program is registered for "${font.technique.id}"`);
    const bindingHandle = this.#nextBindingHandle;
    if (bindingHandle > 0xffff_ffff) throw new RangeError('example renderer exhausted font binding handles');
    const requiredNames =
      shader === undefined ? [...compiled.declaredResources.keys()] : Object.keys(shader.variant.resources);
    const resources: ExampleRendererResourceInput[] = [];
    for (const name of requiredNames) {
      const key = compiled.declaredResources.get(name);
      if (key === undefined) throw new Error(`compiled font omitted declared resource "${name}"`);
      const resource = compiled.resources.get(key);
      if (resource === undefined) throw new Error(`compiled font omitted declared resource "${name}"`);
      resources.push({ id: this.#host.wireIdentities.resourceId(key), generation: 1, name, resource });
    }
    const pending = this.#device?.prepareResources(resources);
    this.#host.registerFontBinding(bindingHandle, font.font.handle, compiled.binding);
    pending?.commit();
    this.#nextBindingHandle += 1;
    return bindingHandle;
  }

  /** The live session, for hosts that compose raw protocol steps themselves. */
  get session(): TextEngineSession {
    if (this.#session === undefined) throw new Error('example engine has no open frame session');
    return this.#session;
  }

  /** Registers a font stack by handle. Shaping fonts themselves come from outside `/core`. */
  registerFontStack(handle: number, fontHandles: readonly number[]): void {
    this.#host.registerFontStack(handle, fontHandles);
  }

  openSession(handle: number): void {
    if (this.#session !== undefined) throw new Error('example engine already has an open frame session');
    this.#session = this.#host.createSession({ handle, requestCapacity: 4096, resultCapacity: 128 * 1024 });
  }

  /** Serializes one frame request, carrying the acknowledged generation automatically. */
  frameRequest(input: ExampleFrameInput): Uint8Array {
    const session = this.session;
    return compileTextEngineFrameUpdate({
      sessionId: session.handle,
      policyHandle: EXAMPLE_POLICY_HANDLE,
      capabilitySet: EXAMPLE_CAPABILITY_SET,
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
  render(input: ExampleFrameInput): ExampleDrawList {
    const device = this.#device;
    const borrowed = this.session.update(this.frameRequest(input));
    this.#engineRevision = borrowed.engineRevision;
    const publication = this.#copyPublication(borrowed);
    const list = readDrawList(publication);
    device?.prepareSubmission(list).commit();
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
    this.#session?.dispose();
    this.#session = undefined;
    this.#host.dispose();
  }
}
