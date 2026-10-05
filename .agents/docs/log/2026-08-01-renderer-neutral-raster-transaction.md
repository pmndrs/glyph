---
type: Log Entry
title: 'Renderer-neutral raster transaction'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Started Milestone 10 by replacing the optional Bitmap-only retained-update seam plus separate build/repaint methods with one required `stageBatch` lifecycle for every raster. The portable batch contract no longer imports Three.js; the Three-backed `Text` adapter validates attachment separately. Bitmap, MTSDF, and Slug now share stage/commit/abort ownership, and focused evidence proves success, injected failure, stale abort, idempotent stage transitions, and preservation of the live scene. Against the closed Milestone 6/8 head, browser core grows by 1,747 raw / 1,053 minified / 207 gzip / 144 Brotli bytes; Bitmap, MTSDF, and Slug runtime closures grow by 2,100/1,253/261/253, 2,783/1,524/345/272, and 2,102/1,256/274/274 bytes respectively. Baker hosts and Wasm remain byte-identical. Only the browser-core raw/minified absolute ceilings and the pre-coverage caps for closures containing the new lifecycle advance; compressed absolute ceilings remain unchanged.
