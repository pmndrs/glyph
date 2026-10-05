---
type: Log Entry
title: 'Binaryen merge pipeline and outlining verdict (D-244)'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Every distributed Wasm artifact now optimizes through
`--merge-similar-functions -Oz --merge-similar-functions -Oz`, removing 8,248 raw bytes from the shaper and 29,214
across the four bakers with unchanged benchmark lanes and byte-identical bake goldens. Explicit stage-seam outlining
of the update path measured size-neutral and is recorded as rejected: the large export body aggregates single-caller
stages rather than duplicating code.
