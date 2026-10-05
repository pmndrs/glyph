---
type: Log Entry
title: 'Adjacent-texel SIMD decision'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Extended the existing MTSDF SIMD runner with an equivalent four-texel scalar tile and a four-neighbor line-distance SIMD candidate while preserving the exact scalar quadratic/cubic solvers. Every native-oracle candidate hash and complete-Inter identity remains exact with no warm Wasm memory growth. Adjacent SIMD improves the bounded Node and Chromium corpora by 2.4% and 0.9%, but complete Inter is indistinguishable warm at 45.068 versus 45.066 seconds while optimized/Brotli size grows 20.7%/11.4%. Scalar tile improves bounded Node by 10.1% but regresses Chromium by 1.5% and complete Inter warm by 1.4% while growing optimized/Brotli size 20.0%/10.9%. Machine-checked structured observations derive those deltas from the retained variants. Scalar remains the sole shipped kernel. Remapped experiment roots retain exact byte identity on the recorded host; foreign hosts reproduce all portable quality, allocation, target-feature, and zero-import contracts under reviewed per-variant size ceilings.
