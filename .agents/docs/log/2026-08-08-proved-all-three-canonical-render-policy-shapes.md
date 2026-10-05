---
type: Log Entry
title: 'Proved all three canonical render-policy shapes'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The retained Rust frame now consumes validated real Inter
Bitmap, MTSDF, and Slug records, derives linear color channels and inverse font size during policy gather without
retained per-glyph arrays, omits the same absent raster records as the portable techniques, and emits the exact
first-party buffer schemas: 48 bytes per Bitmap instance and 112 bytes per MTSDF or Slug instance. SIMD output now
transposes SoA arithmetic lanes into tightly packed vec2/vec4 records before contiguous 128-bit stores. On the
unchanged 25,515-positioned-glyph stress text (21,805 renderable instances), five warmups and 11 samples measure
Bitmap/MTSDF/Slug font-size medians of 5.506/6.396/7.237 ms and full-column-resize medians of
4.477/5.276/6.259 ms. These exceed the sub-4 ms gate and identify the next required invariant: policy validation must
derive physical-buffer dependencies so resize and font-size updates do not execute or publish static UV, color,
band, address, and count buffers. The optimized module is 1,060,971 / 400,835 / 317,139 raw/gzip/Brotli bytes.
