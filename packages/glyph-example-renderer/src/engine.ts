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
import { EXAMPLE_POLICY_HANDLE, exampleRenderPolicyBytes } from './policy.js';
import type { ExampleRendererDevice } from './device.js';

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
 * const owned = session.retain(publication);   // one contiguous copy; acknowledges it
 * readDrawList(owned);                         // decode views over owned bytes only
 * ```
 *
 * Nothing here aliases Wasm memory after `render` returns, so the returned plan may be
 * held across any number of frames and Wasm calls.
 */
export class ExampleTextEngine {
  readonly #host: TextEngineHost;
  readonly #device: ExampleRendererDevice | undefined;
  #nextBindingHandle = 100;
  #session: TextEngineSession | undefined;

  constructor(shaper: RuntimeShaper, device?: ExampleRendererDevice) {
    this.#host = new TextEngineHost(shaper);
    this.#device = device;
    this.#host.registerPolicy(EXAMPLE_POLICY_HANDLE, exampleRenderPolicyBytes());
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
    const bindingHandle = this.#nextBindingHandle++;
    this.#host.registerFontBinding(bindingHandle, font.font.handle, compiled.binding);
    for (const [key, resource] of compiled.resources) {
      this.#device?.createResource(this.#host.wireIdentities.resolve(key), resource);
    }
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
    const latest = this.#latest;
    return compileTextEngineFrameUpdate({
      sessionId: session.handle,
      policyHandle: EXAMPLE_POLICY_HANDLE,
      capabilitySet: 1,
      expectedEngineRevision: latest.engineRevision,
      consumedPlanRevision: latest.planRevision,
      acknowledgedPublicationGeneration: session.acknowledgedGeneration,
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
    const list = readDrawList(this.#retainPublication(this.session.update(this.frameRequest(input))));
    for (const patch of list.patches) {
      if (patch.payload !== undefined) device?.writeBuffer(patch.bufferId, patch.payload);
    }
    for (const retirement of list.retirements) device?.retireResource(retirement.id);
    device?.submit(list);
    return list;
  }

  #latest: Pick<TextEnginePublication, 'engineRevision' | 'planRevision'> = {
    engineRevision: 0,
    planRevision: 0,
  };

  /** The protocol steps between a raw borrow and an owned publication. */
  #retainPublication(publication: TextEnginePublication): RetainedTextEnginePublication {
    const session = this.session;
    session.assertLive(publication);
    const owned = session.retain(publication);
    this.#latest = { engineRevision: owned.engineRevision, planRevision: owned.planRevision };
    return owned;
  }

  dispose(): void {
    this.#session?.dispose();
    this.#session = undefined;
    this.#host.dispose();
  }
}
