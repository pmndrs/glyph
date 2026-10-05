---
type: Log Entry
title: 'Live benchmark telemetry'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Replaced growing CPU/FPS arrays, element shifting, copied sort inputs, and SVG point-string construction with fixed 120-sample `Float32Array` rings, one preallocated quantile scratch buffer, and allocation-free canvas sparkline painting. Added the reserved GPU history graph without substituting CPU time for unavailable timestamp queries. The bitmap benchmark now measures fixture and atlas bytes from the loaded artifact contract, captures environment metadata and immutable history snapshots only on demand, exposes rendered device size and proportional paragraph width, and drives viewport changes through retained `Text` reflow. Benchmark ipsum now uses positive workload copy and renders an executable 1,150-glyph Inter contract; candidate/reference/difference language remains confined to conformance.
