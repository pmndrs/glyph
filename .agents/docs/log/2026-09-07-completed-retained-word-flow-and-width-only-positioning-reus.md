---
type: Log Entry
title: 'Completed retained word flow and width-only positioning reuse'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Sparse prose now retains one 12-byte cumulative
record per word opportunity while dense CJK stays on the existing cluster/chunk path. Whole shaped words, including
negative positioning adjustments and shrinkable spaces, are evaluated before a break. Unchanged start-aligned lines
reuse their committed positioned SoA slices; the 22,000-glyph 500-update A/B moved from 0.314/4.417 to
0.171/3.058 ms median/p95 against exact remote main without changing output.
