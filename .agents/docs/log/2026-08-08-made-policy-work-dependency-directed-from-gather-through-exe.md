---
type: Log Entry
title: 'Made policy work dependency-directed from gather through execution'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Policy registration now compiles both
input-to-buffer and operation-to-buffer reachability. A positioned update gathers only source lanes reaching a
semantically changed output and the scalar/SIMD executors skip operations reaching no active output; checkpoints,
new glyphs, and non-positioning changes remain conservative full evaluations. Consecutive glyphs reuse their resolved
font binding and policy program. The mechanisms compound: selective gather alone regressed and operation liveness
alone was neutral, while together moved canonical Bitmap/MTSDF/Slug resize medians from 4.878/5.355/6.001 ms to
4.207/4.833/5.615 ms. Adding the lookup cache measured 3.981 then 4.120 ms for Bitmap, 4.646 ms for MTSDF, and
5.622 ms for Slug. An isolated Bitmap resize measured 4.799 ms, so JIT-sensitive evidence does not yet close the
sub-4 ms gate. Optimized Wasm is 1,069,973 / 405,888 / 319,558 raw/gzip/Brotli bytes.
