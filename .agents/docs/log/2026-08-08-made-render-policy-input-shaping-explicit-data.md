---
type: Log Entry
title: 'Made render-policy input shaping explicit data'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Policy programs now retain compiler-mapped source records for
every typed input lane, selecting numeric semantic, glyph, resource, or strike data without callbacks. Source order
is validated and fingerprinted; Rust and compiled-Wasm tests cover exact decoding, conflict, unknown/reserved data,
count mismatch, and overlap. The optimized ABI grows from 828,401 / 309,252 / 244,402 to 829,906 / 309,646 / 244,790
raw/gzip/Brotli bytes. Per-font binding tables and gather execution remain open, so there is no frame timing claim.
