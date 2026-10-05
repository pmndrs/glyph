---
type: Log Entry
title: 'Broke lines at unsafe legal boundaries with shaped corrections'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Unicode-legal breaks that HarfRust marks unsafe
are now allowed within one run, binding, and font and priced from lazily shaped, edit-carried boundary corrections,
including in min-content width. Added the `edit` package Labs suite for keystroke cost. See D-372 in
[the decision register](../planning/decision-register.md), [the package reference](../packages/glyph.md), and
[the benchmark package reference](../packages/benchmarks.md).
