---
type: Log Entry
title: 'Avoided identity hashing for order-preserving reflow'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Positioned glyph reconciliation now checks the common
equal-length/equal-stable-ID order first and compares exact content by slot; reordered output retains the exact
identity-index fallback. A symbolized, non-shipping Wasm CPU profile identifies positioning as the largest sampled
column-resize function and policy gather as the next largest. The benchmark can now isolate one case and accept an
explicit profiling Wasm without changing the canonical default sequence. On the unchanged five-warmup/11-sample
workload, Bitmap/MTSDF/Slug resize medians are 4.414/4.984/5.196 ms; variance prevents attributing a precise speedup,
and the sub-4 ms gate remains open. The optimized module is 1,065,543 / 399,248 / 318,131 raw/gzip/Brotli bytes.
