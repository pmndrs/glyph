---
type: Log Entry
title: 'Deduplicated exact ordered/stable planner machinery with measured delivery savings'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

A focused Mori 0.19.1 audit
identified shared identity membership, error conversion and capacity classification, cold buffer allocation, and
draw-span invariants. Rust now owns each once while keeping the distinct ordered-direct and stable-indirect address
loops local and allocation-free. The optimized shaper moves from 1,160,505 / 442,612 / 348,594 raw/gzip/Brotli bytes
to 1,159,317 / 442,284 / 347,850, saving 1,188 / 328 / 744 bytes. All 158 Rust tests pass; the 22k complete benchmark
shows no material warm-path change, and a 51-sample cold check measures 15.452 ms median / 15.670 ms p95 at 1.0% RSD.
