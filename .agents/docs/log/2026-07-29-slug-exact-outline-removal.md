---
type: Log Entry
title: 'Slug exact-outline removal'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Removed the dynamic closest-distance outline from the Slug runtime after the retained 268-glyph scene measured `2.44×–4.33×` fill-only GPU time across WebGPU/WebGL2 and DPR 1/2. Slug V0 now rejects every outline or shadow paint property before allocation or mutation; MTSDF retains the generic outline API. A dedicated research concept preserves the rejected algorithm, generated-program defects, public implementation survey, and a go/no-go gate for one bounded shared-traversal approximation whose quality must be no worse than MTSDF and whose cost must stay near fill.
