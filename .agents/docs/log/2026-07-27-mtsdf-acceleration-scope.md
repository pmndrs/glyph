---
type: Log Entry
title: 'MTSDF acceleration scope'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Clarified that the rejected SIMD result covered one-texel four-channel quantization, not adjacent-texel curve evaluation. Item 8.6 may compare equivalent scalar and true multi-texel SIMD tile kernels after phase instrumentation, and may research a lazy TypeGPU compute baker with explicit WGSL, scalar-Wasm fallback, same-device resident output, and measured Worker readback costs.
