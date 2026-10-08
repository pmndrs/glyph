---
type: Log Entry
title: 'Restored retained paragraph scaling and Bitmap CPU batching'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Metric-only style mutations now refresh shaping-run
typography before rebuilding cluster advances while retaining the HarfRust glyph result. Optimized-Wasm tests prove a
2× font-size change produces a 2× inline advance. Bitmap strikes now bind all atlas pages as one texture array with a
per-glyph layer lane, collapsing multi-page prose to one ordered draw. Clean Chrome Paragraph Stress verification kept
Bitmap, MSDF, and Slug correctly positioned at 96 px and during animated intermediate sizes; Bitmap CPU sampled at
0.47–1.3 ms instead of the reproduced roughly 80 ms failure, while GPU remained independently around 1–5 ms.
