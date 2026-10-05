---
type: Log Entry
title: 'Final layout and renderer performance gates found no material regression'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Eight matched Rust/Wasm matrices cover
Bitmap, MTSDF, and Slug under ordered and stable allocation plus CJK Bitmap at roughly 22,000 glyphs. Across 35
low-variance cases the median head-to-base change is +0.29%; 101- and 301-sample confirmations put the largest apparent
changes between -0.52% and +1.39%. The Three lab retains one 12-instance draw at a 0.090 ms generic warm median, while
TypeGPU/WebGPU produces changed visible pixels with zero idle submissions at a 0.320 ms submission median.
