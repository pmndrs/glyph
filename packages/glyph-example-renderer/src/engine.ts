import {
  compileTextEngineFrameUpdate,
  TextEngineHost,
  type RetainedTextEnginePublication,
  type RuntimeShaper,
  type TextEngineFrameLimits,
  type TextEngineParagraphMutation,
  type TextEnginePublication,
  type TextEngineSession,
  type TextEngineStyleMutation,
  type TextEngineTextMutation,
} from '@pmndrs/glyph/core';

import type { ExampleDrawList } from './draw-list.js';
import { readDrawList } from './plan-reader.js';
import { EXAMPLE_POLICY_HANDLE, exampleRenderPolicyBytes } from './policy.js';

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
  #session: TextEngineSession | undefined;

  constructor(shaper: RuntimeShaper) {
    this.#host = new TextEngineHost(shaper);
    this.#host.registerPolicy(EXAMPLE_POLICY_HANDLE, exampleRenderPolicyBytes());
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
    });
  }

  /** Runs one real frame and returns its plan, retained into host-owned memory. */
  render(input: ExampleFrameInput): ExampleDrawList {
    return readDrawList(this.#retainPublication(this.session.update(this.frameRequest(input))));
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
