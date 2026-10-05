---
type: Log Entry
title: 'Milestone 8.6 planning'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added bounded runtime Bitmap/MTSDF atlas options, compiler-derived `#[repr(C)]` Wasm ABI layouts, complete ABI/Wasm/fixture regeneration, phase-level baker profiling, and measured allocator selection as required pre-closure work. Current evidence attributes the long complete-face MTSDF bake primarily to serial per-texel edge-distance evaluation—45.38 seconds cold and 48.13 seconds warm for the independent 2,915-glyph Inter kernel, versus 95–109 seconds for the 39,111,736-texel artifact path—while requiring instrumentation before assigning the remaining time to packing, serialization, or copies.
