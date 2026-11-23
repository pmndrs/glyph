---
type: Log Entry
title: 'Glyph facts without a second read'
generated:
  by: process:docs-new
  at: '2026-11-23T10:30:49Z'
---

Recovers the speed `dfb1b238a` ("compute a summary's glyph facts on first read") cost every read of a summary's glyph
facts, found by the [2026-11-23 regression sweep](../planning/regression-sweep-2026-11-23.md), while keeping the
[deferred positioning decision](../planning/decisions/summary-only-reads-defer-positioning.md) and lazy facts (1a).

Root cause, from Node CPU profiles of g51 against g52 with named shaper builds:

- Every deferred summary built each line with `Object.defineProperties` plus two weak-collection entries per line:
  37% of a 22k-glyph size-only read.
- A caller that read `glyphCount` after every `measure()` paid a second engine call, a second full summary encode and
  decode, and the flow summary on top of the positioned one.
- An unread summary made the next preparation of its paragraph return its prior facts as a full summary that the host
  decoded in full; for one-line labels, whose inline leaves position as they prepare, all of this bought nothing.
- Every measurement measured each line twice: `flow_extents` only to read how many clusters the lines consumed.

Fix ([glyph concept](../packages/glyph.md)): `flow_consumed_clusters`; a TypeScript-only `availableGlyphFacts` view bit
that carries facts when positioning is current after preparation; a text whose caller read its last summary's facts
asks for them up front on its next read and keeps observing whether they are read; deferred summaries decode their
lines on first read of `lines`; prior and resolved facts decode only the facts. No oracle reference moved.

Evidence (machine load 3–8, paired within rounds; tip/g51 medians):

- Headline harness, 6 rounds: `measure()` after a width change reading `glyphCount` 1.01 Latin, 0.91 22k, 0.95 bidi;
  edit `:layout` 0.97–1.02 (Latin, 22k, bidi); 22k edit frames 0.97–0.99; size-only `measure()` 0.26 (bidi), 0.44
  (22k), 0.49 (Latin), frames 0.99–1.00.
- Labs full suite, 3 rounds: measurement after width change 0.62, measurement then publication 0.66, long unsafe-line-break
  reflows 0.69 and 0.78; every `[setter + read]` row in batching, stress, edit and lifecycle 0.65–1.01 except
  "10/100 labels last color-only" (1.08–1.10, already noisy in the sweep); sparse-assignment split-move 0.86 and 0.91.
- `benchmark:headline-bidi-edit` g51 against this tip, 5 rounds: 0.97–1.01.
- Native and wasm oracle full tier: 596 references equal, 0 unlisted divergences; nothing re-frozen.
