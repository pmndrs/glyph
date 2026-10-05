---
type: Log Entry
title: 'Bounded retained raster capacity'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Completed roadmap item 10.3 by giving Bitmap, MTSDF, and Slug deterministic 25% instance slack capped at 256 glyphs, separate logical draw counts, complete in-place parallel-field replacement, transactional overflow/topology replacement, and shared 32-instance dirty buckets with an eight-range full-upload fallback. Unconsumed Three.js update ranges carry into later stages. Focused tests prove arbitrary glyph replacement, shrink, exact-capacity growth, retained object/buffer identity, abort preservation, overflow disposal, Bitmap/Slug page-run changes, and color-only preservation; existing Text and Slug lifecycle suites remain green. Browser core, every baker host, and every Wasm artifact remain byte-identical. Optional Bitmap, MTSDF, and Slug closures grow by 5,155/2,779/627/598, 6,038/3,148/778/762, and 9,309/4,976/1,238/1,204 raw/minified/gzip/Brotli bytes, respectively, without changing existing absolute budgets.
