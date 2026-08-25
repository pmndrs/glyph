/**
 * The retention and ownership protocol over the render plan, in one place.
 *
 * - **Borrowed by default.** Every {@link TextEnginePublication} the session hands out points
 *   straight into Wasm memory. It expires when the session answers any later call — another
 *   update, a synchronous paragraph measurement, even a failed attempt that reserves capacity —
 *   and when the session is disposed. Slot arithmetic means some bytes physically survive
 *   longer; the protocol deliberately does not ask hosts to track that.
 * - **Expiry is cheap and loud.** `session.isExpired(publication)` is two integer compares and
 *   runs before anything is decoded; `session.assertLive(publication)` throws
 *   {@link TextEnginePublicationExpiredError} instead of letting a stale view feed garbage to
 *   the GPU. A publication the session did not issue is rejected outright.
 * - **Retention is one contiguous copy.** `session.retain(publication)` copies the whole
 *   encoded result once and brands it {@link RetainedTextEnginePublication}. Patch payloads are
 *   offsets inside the publication range, so the copy is self-contained: tables, payloads, and
 *   header stay readable forever.
 * - **Acknowledgement is load-bearing.** The engine defers resource retirements until the host
 *   has acknowledged consuming a publication (`retirements` carry
 *   `afterPublicationGeneration`), and rejects a frame whose acknowledged generation goes
 *   backwards. `retain()` acknowledges implicitly — taking the copy *is* taking what you need —
 *   and `acknowledge()` covers hosts consuming the borrow in place. A transactional renderer
 *   carries its last device-accepted generation separately until submission commits.
 * - **Dirty ranges, not whole arrays.** The `patches` table names buffer deltas by
 *   `(bufferId, bufferGeneration)` with destination offsets and payload ranges; a host applies
 *   those instead of re-uploading whole arrays. `readTextEnginePatch` surfaces them decoded.
 * - **Identity survives updates by construction.** Paragraph ids are caller-chosen handles,
 *   durable until removal. Glyph identity is the policy's stable-glyph-id lane, which survives
 *   reflow within a paragraph's lifetime. Engine storage is keyed by `(id, generation)`:
 *   a changed generation is new storage, and a retirement naming `(kind, id, generation)` is
 *   the only signal to release the old copy. Atlas and texture resources follow the same rule
 *   through their `referenceId`.
 */

import type { TextEnginePublication } from './host.js';

/**
 * Ownership brand for a publication whose bytes are host-owned copies.
 *
 * A plain {@link TextEnginePublication} borrows the engine's Wasm memory and expires at the
 * session's next call; a retained one is a single contiguous copy of the whole encoded result
 * — header, every table, and every patch payload — and never expires. The distinction is in
 * the type system: an API that stores plan data across frames declares the retained brand in
 * its parameter, so passing a borrowed publication is a compile error rather than a latent
 * read of freed memory.
 */
export interface RetainedTextEnginePublication extends TextEnginePublication {
  readonly [retainedPublicationBrand]: true;
}

/**
 * Runtime witness of the retained brand. Only this package constructs it; hosts only
 * ever receive branded publications from {@link TextEngineSession.retain}.
 */
export const retainedPublicationBrand: unique symbol = Symbol('pmndrs.glyph.retainedPublication');

/** Thrown when a host reads a borrowed publication after the engine reclaimed its bytes. */
export class TextEnginePublicationExpiredError extends Error {
  /** The publication generation the host tried to keep reading. */
  readonly consumedGeneration: number;
  /** The newest generation the session has published or answered with since. */
  readonly latestGeneration: number;

  constructor(consumedGeneration: number, latestGeneration: number) {
    super(
      `text-engine publication ${consumedGeneration} expired` +
        (latestGeneration === consumedGeneration ? '' : ` at generation ${latestGeneration}`) +
        ': borrowed bytes are valid only until the session answers its next call; retain what must survive',
    );
    this.name = 'TextEnginePublicationExpiredError';
    this.consumedGeneration = consumedGeneration;
    this.latestGeneration = latestGeneration;
  }
}
