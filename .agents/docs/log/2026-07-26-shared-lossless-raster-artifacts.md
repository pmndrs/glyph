---
type: Log Entry
title: 'Shared lossless raster artifacts'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Began item 8.2 by extracting the canonical 20-byte glyph records, checked shelf atlas, lossless linear R8/RGBA8 KTX2 encoder, GLB framing, SHA-256 identities, and packaging enums into one `no_std + alloc` Rust support crate shared by bitmap and MTSDF bakers. Exact Inter bitmap records, pages, GLBs, and reports remain byte-identical. The bitmap baker grows by 8,749 raw / 1,735 Brotli bytes for the checked shared boundary; those bytes remain inside optional baker Wasm and never enter shaping or rendering bundles.
