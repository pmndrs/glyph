---
type: Log Entry
title: 'MTSDF candidate size'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added a non-shipping package-owned admission harness for exact `klyff_msdf` 0.1.3 with default features disabled. The locked graph contains no WGPU or duplicate font parser; `wasm32-unknown-unknown` imports nothing; and a fixed 40×40 synthetic MTSDF returns FNV-1a `1627af29` after correcting its outer-contour winding to the TrueType convention. Reproducible Rust 1.97.1 plus Binaryen 129 records 81,308 raw, 72,510 optimized, 32,161 gzip, and 27,829 Brotli bytes. A blocker-sensor test still proves the published invalid-threshold API panics, so viable size does not admit the dependency.
