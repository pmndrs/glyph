---
type: Log Entry
title: 'Make full-suite sampling policy explicit before parity measurements'
generated:
  by: process:docs-new
  at: '2026-10-21T03:51:00Z'
---

Added an explicit single-call sampling path through the pinned Labs 0.9.0 config, CLI and worker, using the existing
measurement loop. The normal default remains adaptive. The package benchmark runner records the selected policy,
authenticates dependency-patch bytes, and prevents reuse of adaptive data as fixed-policy data. Benchmark callbacks,
fixtures and Glyph runtime bytes are unchanged. The [benchmark package concept](../packages/benchmarks.md) owns the
workflow and proof scope.

The actual patched CLI/worker proof passes eight fresh blocks, fixed-plan checks, deterministic adaptive/fixed controls
and invalid-policy rejection. These fixture clock values are protocol correctness evidence, not Glyph speed evidence.
Fresh review required a policy-bound digest and exact expected baseline identities before timing release. Both findings
were corrected, eleven focused comparison tests and static checks pass, and High re-review clears the protocol subject
to the final artifact/source bridge. Full baselines default to all145 exact candidate identities; the explicit published
availability declaration permits only the two named absent outline operations. The new series must not pool historical
adaptive measurements.

The [frontier](../planning/publication-frontier.md) preserves all seven families and the full parity goal. Legacy 5%
Labs labels remain presentation diagnostics; admission reads unrounded confidence intervals, p-values and shifts with
no magnitude floor. Published 0.1.0 lacks two outline operations; their unavailability stays explicit. All stack layers
remain held/unmerged, with no release, tag or demo merge.
