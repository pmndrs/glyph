---
type: Log Entry
title: 'Routed package performance by intent'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Pull requests now run only the concise installed-package smoke comparison by
default. Explicit `benchmark:<suite>` labels select focused or full evidence, pushes to `main` run the full matrix, and
manual dispatch exposes the same choices. Browser, conformance, payload, and native profiling remain separate lanes.
See [the benchmark package reference](../packages/benchmarks.md) and D-370 in
[the decision register](../planning/decision-register.md).
