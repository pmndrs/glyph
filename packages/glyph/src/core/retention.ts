/**
 * The retention and ownership protocol over the render plan, in one place.
 *
 * - **Borrowed by default.** Every {@link PlanPublication} the transport hands out points
 *   straight into Wasm memory. It expires when the transport answers any later call — another
 *   update, a synchronous paragraph measurement, even a failed attempt that reserves capacity —
 *   and when the transport is disposed. Slot arithmetic means some bytes physically survive
 *   longer; the protocol deliberately does not ask hosts to track that.
 * - **Expiry is cheap and loud.** `planner.isExpired(publication)` is two integer compares.
 *   `transport.copyPublication(publication)` performs the throwing check before copying, so a stale
 *   view cannot silently feed garbage across an ownership boundary.
 * - **Ownership is one contiguous copy.** `transport.copyPublication(publication)` copies the whole
 *   encoded result once and brands it {@link OwnedPlanPublication}. Patch payloads are
 *   offsets inside the publication range, so the copy is self-contained: tables, payloads, and
 *   header stay readable forever.
 * - **Acceptance is load-bearing.** The engine defers resource retirements until the renderer
 *   reports its last device-accepted publication on the next frame (`retirements` carry
 *   `afterPublicationGeneration`), and rejects a generation that goes backwards. Copying bytes
 *   is not device acceptance; a transactional renderer advances only after submission commits.
 * - **Dirty ranges, not whole arrays.** The `patches` table names buffer deltas by
 *   `(bufferId, bufferGeneration)` with destination offsets and payload ranges; a host applies
 *   those instead of re-uploading whole arrays. The internal command-buffer projection exposes
 *   them as typed buffer updates without publishing the raw wire rows.
 * - **Identity survives updates by construction.** Paragraph ids are caller-chosen handles,
 *   durable until removal. Glyph identity is the policy's stable-glyph-id lane, which survives
 *   reflow within a paragraph's lifetime. Engine storage is keyed by `(id, generation)`:
 *   a changed generation is new storage, and a retirement naming `(kind, id, generation)` is
 *   the only signal to release the old renderer resource. Atlas and texture resources follow the same rule
 *   through their `referenceId`.
 */

import type { PlanPublication } from '../internal/handle-state.js';

/**
 * Ownership brand for a publication whose bytes are host-owned copies.
 *
 * A plain {@link PlanPublication} borrows the engine's Wasm memory and expires at the
 * transport's next call; an owned one is a single contiguous copy of the whole encoded result
 * — header, every table, and every patch payload — and never expires. The distinction is in
 * the type system: an API that stores plan data across frames declares the owned brand in
 * its parameter, so passing a borrowed publication is a compile error rather than a latent
 * read of freed memory. Runtime provenance is local to one JavaScript realm and is not
 * preserved by structured cloning.
 */
export interface OwnedPlanPublication extends PlanPublication {
  readonly [ownedPublicationBrand]: true;
}

declare const ownedPublicationBrand: unique symbol;

const ownedPublications = new WeakSet<object>();

/** Rejects a value that was not copied by {@link PlanTransport.copyPublication}. */
export function assertOwnedPlanPublication(value: unknown): asserts value is OwnedPlanPublication {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null || !ownedPublications.has(value)) {
    throw new TypeError('publication was not copied by PlanTransport.copyPublication');
  }
}

/** @internal Records the package-private runtime provenance of one owned publication. */
export function markOwnedPlanPublication(publication: PlanPublication): OwnedPlanPublication {
  ownedPublications.add(publication);
  return publication as OwnedPlanPublication;
}

/** Thrown when a handle reads a borrowed publication after the engine reclaimed its bytes. */
export class PlanPublicationExpiredError extends Error {
  /** The publication generation the host tried to keep reading. */
  readonly consumedGeneration: number;
  /** The newest generation the transport has published or answered with since. */
  readonly latestGeneration: number;

  constructor(consumedGeneration: number, latestGeneration: number) {
    super(
      `text-engine publication ${consumedGeneration} expired` +
        (latestGeneration === consumedGeneration ? '' : ` at generation ${latestGeneration}`) +
        ': borrowed bytes are valid only until the transport answers its next call; copy what must survive',
    );
    this.name = 'PlanPublicationExpiredError';
    this.consumedGeneration = consumedGeneration;
    this.latestGeneration = latestGeneration;
  }
}
