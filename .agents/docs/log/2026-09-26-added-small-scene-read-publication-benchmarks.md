---
type: Log Entry
title: 'Added small-scene read-publication benchmarks'
generated:
  by: process:docs-new
  at: '2026-10-05T20:05:21Z'
---

The `@one-label` selection covers mounting and reading a label
before its first frame, editing one label and reading its glyphs, and editing one label with only a draw. Title
splitting, text-field typing, and caret placement now also run in a small scene. Bulk scene workloads remain for
stress evidence. Eight-block runs of packed baseline `504ffbdf` and candidate `97ca2a85` matched all six outcomes.
The three `@one-label` cases, title splitting, and field typing were neutral at the measured resolution. Caret
placement in the small scene was 85.4% faster (p < .001). Timings include scene traversal but exclude GPU work. See
[benchmark ownership](../packages/benchmarks.md).
