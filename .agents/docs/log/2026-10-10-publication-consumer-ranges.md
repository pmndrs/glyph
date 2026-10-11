---
type: Log Entry
title: 'Retained publication consumes changed owners and cached gather ranges'
generated:
  by: openai-codex/gpt-6
  at: '2026-10-10T00:23:38Z'
sources:
  - resource: ../planning/retained-text-assignment.md
    title: Retained assignment and publication plan
  - resource: ../../../packages/glyph/rust/shaper/src/engine/state.rs
    title: Existing preparation and publication owner
  - resource: ../../../packages/glyph/rust/shaper/src/engine/codec_gather.rs
    title: Existing retained gather cursor
---

The local publication consumer integration replaces whole-root paragraph settlement with staged and unpublished owner
frontiers over the same retained paragraphs and commit operation. It reserves growth before mutation, preserves prior
preparations across abort, and retires removed identities before reuse. Existing gather now advances opaque unchanged
paragraph ranges under its exact cache key, zeroing stale masks without glyph walks; changed/decorated/shifted cases use
the same gather and suffix rebuild. Empty semantic input skips redundant preparation discovery. Transactional placement
rebinding explicitly marks its positioned owner changed so masks are consumed and cleared correctly.

The real-font 10/100/1,000-label oracle now gathers one glyph and settles one paragraph for one changed label, versus
the baseline's root-sized counts. Paragraph summaries, placement and render-plan preparation remain root-wide, and
count-changing edits retain suffix rebuild. The frozen source passes 334 native engine tests, including cold/fresh
range checks, deterministic cold/full mutation oracles and lifecycle retirement coverage; static checks pass. Final
package, browser and Labs gates remain outstanding. This is work-count evidence, not a timing or release verdict.

The preceding eight-block cleanup candidate remains held after mixed Labs evidence (6 faster, 3 slower, 36 neutral,
2 clock-confounded exclusions). The new publication change has not been benchmarked. Main is 305e5ec9 after the
independent #290 merge; ASCII is synced and its recovered changes remain preserved. No stable release was published.
