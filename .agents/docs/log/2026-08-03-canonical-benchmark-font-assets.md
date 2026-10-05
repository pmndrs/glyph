---
type: Log Entry
title: 'Canonical benchmark font assets'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Moved source-font selection, baked fixture URLs, authenticated gzip transport, public `FontLoader` runtime fallback, raster requests, progress, and delivery metrics from renderer-owned files into `workloads/font-assets`. One discriminated adapter selects Bitmap, MTSDF, or Slug through literal dynamic imports; workload code cannot reach direct baker or Wasm URLs, while renderer modules retain live GPU lifecycle and compatibility delegates. Review restored post-registration abort checks and corrected runtime source-font selection. The complete 310-test benchmark gate, production chunk build, React Doctor, all 42 dual-backend Presentation workload cells, both timed demos at 60.02/60.47 Icon Grid FPS, all 19 headless conformance scenarios, and the dual-backend external raster proof passed.
