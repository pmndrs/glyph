---
type: Log Entry
title: 'Closed the line-break feedback seam'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Kept break admission on the existing exact inclusive F16.16 comparison and
changed only measurement publication: sizes, content extents, and intrinsic widths now round outward when their f64
authority is not exactly representable by the public f32 ABI. A pinned counterexample at 39,000,001 layout units used
to publish one unit short and could break a word when fed back as an exact constraint; the outward value quantizes at
or above the original content. Indexed and scalar fit tests distinguish exact width from ±1 layout unit, and a sweep
across f32 precision boundaries proves publication never undershoots. No epsilon or history-dependent hysteresis was
added. Host point-scale rounding remains required after external box-model arithmetic. The optimized shaper cost is
372 raw / 223 gzip / 320 Brotli bytes over the immediately preceding cleanup checkpoint.
