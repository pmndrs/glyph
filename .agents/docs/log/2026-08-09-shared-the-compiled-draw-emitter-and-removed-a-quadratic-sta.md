---
type: Log Entry
title: 'Shared the compiled draw emitter and removed a quadratic stable-plan scan'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

A symbol-bearing `-Oz` build attributes
33.3 KiB of optimized function bodies to ordered planning and 50.1 KiB to stable planning, while confirming that the
planners retain different storage, order-buffer, and retirement work. Their identical final primitive/draw record
construction now calls one non-generic out-of-line kernel once per draw span. The strict stable benchmark then exposed
that every changed range rescanned every sorted slot write; exact range partitioning reduces 22k-target font-size from
350.136 to 7.982 ms median and column resize from 49.636 to 3.767 ms. Stable splice is 9.372/9.583 ms median/p95 with
452 B written. The combined final artifact is 1,160,323 raw / 442,570 gzip / 348,361 Brotli bytes, 220 / 485 / 423 bytes
smaller than the pre-extraction Wasm. Compile-time `lite`, `cjk`, and `full` runtime profiles remain a later measured
delivery experiment with one ABI; separate Wasm assets, not one bundle containing every variant, provide transfer wins.
