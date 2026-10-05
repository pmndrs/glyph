---
type: Log Entry
title: 'Icon-grid submission containment'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Kept three-row/column overscan assignments warm for flash-free recycling while hiding every tile outside the exact viewport from Three's render traversal. At a 1,280×1,280 profile viewport, Main retains 221 assigned tiles but submits 60, reducing draws from 442 to 120; Presentation retains 340 but submits 130, reducing draws from 680 to 260. Static tile-local transforms now opt out of per-frame matrix recomputation while the panned scene transform remains dynamic. Six WebGPU profiles across Bitmap, MTSDF, and Slug held about 120 FPS with zero long tasks and reduced median CPU submit from 1.8–3.0 milliseconds to 1.3–1.9 milliseconds. Compatible independent `Text` objects remain separate draws; transparent renderer-level auto-batching is future work.
