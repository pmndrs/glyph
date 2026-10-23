---
type: Log Entry
title: Unify ordered instance range updates
sources:
  - resource: ../planning/publication-frontier.md
    title: Current evidence, source identities and remaining gates
  - resource: ../packages/glyph.md
    title: Shared publication ownership
  - resource: local-artifact:.cache/retained-prepare-publish-wave2/order-ownership-wave/ordered-range-wave/primary-review.md
    title: Reviewed bounded source change
generated:
  by: openai-codex/gpt-6
  at: '2026-10-16T15:13:08Z'
---

Completed the inspection wave's final-source build and paired four-block publication comparison, timing candidate d6b0f5a0 once. Width inspection plus publication p50/p95 improved from main10.989/16.826 to7.262/12.109ms; dense1024 remained slower at29.069/31.628 versus main23.584/30.361 and release23.905/26.043ms. Candidate clock drift8.7% and release baseline7.4% qualify the results. Final summaries and exclusions remain in the frontier; no universal parity orFPS claim follows.

After its exact post-run closure was captured, applied the source-reviewed ordered instance correction: one coalesced dirty-range stream through the existing rope updater replaces repeated root walks, and batch patch ranges share that coalescer. Production shrinks by8lines; the existing full/sparse cold-host and abort/commit test shares its setup. Formatting, correctness, size and later coherent performance gates are pending for this edit. Ropes remain held/unmerged; the seven-family scope and unresolved dense priority are unchanged.
