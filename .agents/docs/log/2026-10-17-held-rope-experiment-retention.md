---
type: Log Entry
title: 'Preserve inconclusive HELD candidates for combination tests'
generated:
  by: process:docs-new
  at: '2026-10-17T18:44:03Z'
---

The user directs preservation of correct but inconclusive performance candidates under descriptive names, followed by compatible combination tests. This supersedes closing the compiler option solely for missing the old materiality floor; small cumulative gains count, while uncertainty remains explicit. The [compact frontier](../planning/publication-frontier.md) now records that rule and the next bounded combination.

The existing compiler package, matching named Wasm, manifests and function map were copied and hash-verified under `.cache/held-experiments/held-one-caller-default-inconclusive-2026-10-17/`. A local Git branch of the same descriptive name under `experiments/` preserves the committed reproducer at `7347b549`. The [portable index](../../../benches/reports/held-ropes-local-2026-10-16/experiment-retention.json) records identities and local-only availability. No runtime source or compiler policy changed, and no new timing ran. The preparation cleanup stays retained; the shape/flow review produced no patch. Combined performance remains unmeasured. Correctness failures and proven regressions remain distinct from inconclusive timings.
