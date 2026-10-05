---
type: Log Entry
title: 'Render controls boundary'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Moved the parity-preserved Main/Presentation render controls and detailed payload/resource inspector out of the harness. The extracted boundary owns control-only workload descriptions, authenticated fixture lookup, package-size accounting, disclosure rows, and Presentation's minimal-mode filtering; `app.tsx` now keeps the state transitions and passes typed values/callbacks across that boundary.
