---
type: Log Entry
title: 'Admitted explicit-SIMD render-policy execution'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added a production scalar interpreter for validated straight-line
render policies and a four-record `simd128` executor with scalar tails. Registration resolves policy buffer IDs once;
warm execution consumes borrowed semantic SoA fields, preflights every output, allocates nothing, and requires every
direct-memory region to remain inside a live host allocation before borrowing retained engine state. Scalar,
auto-vectorized, and explicit-SIMD artifacts produce identical horizontal, vertical, partial-tail, and four-byte-
aligned outputs. At 25,515 glyphs, the representative 17-operation policy improves p95 from 1.174 to 0.428 milliseconds
in Node and 1.113 to 0.438 milliseconds in Chromium. The production SIMD artifact is 530 raw bytes smaller and 62
Brotli bytes larger than scalar. Boundary search, native SIMD, and whole-update contribution remain unmeasured.
