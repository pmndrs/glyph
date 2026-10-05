---
type: Log Entry
title: 'Removed visual-order scratch from proven LTR positioning'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

A positioning pass now checks once that all retained
bidi levels are even and no run is direction-overridden, then walks logical clusters directly. Odd levels and
overrides retain the complete UAX #9 L1/L2 path. On the unchanged 25,515-positioned/21,805-renderable stress case,
two adjacent eight-warmup/31-sample Bitmap baselines measured 5.197/5.162 ms and two optimized runs measured
4.849/4.878 ms with the same single 170.4 KiB patch. Post-change MTSDF/Slug medians are 5.355/6.001 ms; the sub-4 ms
gate remains open. Optimized Wasm is 1,065,857 / 403,525 / 318,137 raw/gzip/Brotli bytes.
