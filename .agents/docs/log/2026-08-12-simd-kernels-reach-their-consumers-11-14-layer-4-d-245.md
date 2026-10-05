---
type: Log Entry
title: 'SIMD kernels reach their consumers (11.14, layer 4 / D-245)'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Two lab-admitted kernels graduated into
`engine/line_kernels.rs` production consumers: transition masks now drive the bidi run scan (sixteen levels per
step instead of a per-unit compare) and flag masks drive the justification space scan over the new
`CLUSTER_SPACE` flag, which also replaced per-cluster text lookups everywhere justification detects spaces. Each
kernel is one scalar function with a `cfg(simd128)` sixteen-lane prefix and a scalar tail, proven equal by
boundary-sweeping parity tests natively and exercised on the SIMD path by every layout integration test against
the shipped simd128 Wasm. Chunk-64 advance summaries stay lab-admitted with the reason recorded in D-245: exact
parity for whole-chunk width arithmetic needs a fixed-point cluster-advance representation first.
