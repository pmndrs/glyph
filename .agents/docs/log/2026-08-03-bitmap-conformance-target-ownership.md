---
type: Log Entry
title: 'Bitmap conformance target ownership'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Moved the remaining finite Bitmap and source-outline wrappers from the live renderer into `benchmark/targets/conformance/raster/bitmap-capture`, retaining the renderer-neutral finite scene and exact atlas reference under `benchmark/low-level/raster`. Conformance targets, runtime fallback, and the React finite surface now import only the target wrapper; boundary tests reject every old renderer capture path. The complete 314-test benchmark gate and production build passed, and all 19 isolated browser scenarios—including exact Bitmap product and source-outline captures—remained deterministic.
