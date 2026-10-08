---
type: Log Entry
title: "Separated Three's public registration DSL from its registry engine"
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The direct plan-program leaf now exposes only
custom-raster registration types, input validation, and stable Codec metadata. Compiled snapshots and lifecycle state
moved under `/three/internal`, mixed implementation leaves are exact-denied, and an unused retained-geometry validation
pass was deleted instead of carried forward.
