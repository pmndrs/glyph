---
type: Log Entry
title: 'Separated shaping-font identity from render-binding identity'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Rust font stacks now contain loaded-font binding
handles, and each binding names its shared shaping-font handle. Shaping, metrics, and extents continue through the
retained font once; policy gather follows the selected binding, so the same face may carry multiple raster techniques
and fallback preserves its technique into the emitted plan. A compiled-Wasm Inter → Devanagari fallback emits the
second technique, and another fixture registers two techniques against one shaping font. The unchanged
25,515-positioned/21,805-renderable resize medians are 4.217/4.791/5.633 ms for Bitmap/MTSDF/Slug; 6–7% run RSD does
not establish a regression from 4.120/4.646/5.622 ms. Wasm is 1,070,580 / 402,114 / 319,662 raw/gzip/Brotli bytes.
