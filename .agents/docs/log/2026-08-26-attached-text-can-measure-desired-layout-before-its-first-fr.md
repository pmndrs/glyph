---
type: Log Entry
title: 'Attached text can measure desired layout before its first frame'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

`Text.layout()` now creates or reconciles its
batch after attachment and uses a non-publishing paragraph query without matrix traversal, material or GPU realization,
or draw publication. Sequential group queries share one speculative lifecycle candidate that the first traversal can
adopt. Detached measurement remains `Paragraph`; fixed capacity reports desired metrics while retaining the last
accepted draw and reevaluates recovery every traversal rather than latching a rejection.
