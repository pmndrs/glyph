---
type: Log Entry
title: 'Lifecycle payload refresh'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Refreshed the single-build package-size identity and its fail-closed autoresearch provenance after the final `Text` invalidation fixes. Browser core grows by 678 raw / 391 minified / 75 gzip / 106 Brotli bytes; optional baker hosts and Wasm artifacts remain byte-identical. The browser core's reviewed raw ceiling moves from 330,000 to 331,000 bytes. The independent pre-coverage caps advance only for browser core and the Bitmap/MTSDF runtime closures that contain it, with 13–120 bytes of headroom over current values; every absolute minified/compressed budget and every baker/Wasm limit is unchanged.
