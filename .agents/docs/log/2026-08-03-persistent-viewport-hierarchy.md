---
type: Log Entry
title: 'Persistent viewport hierarchy'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Moved the Bitmap, MTSDF, and Slug live-text viewport controllers, their warm update queues, loading chrome, telemetry attributes, and shared contracts from the route coordinator into `surfaces/benchmark`. Review caught mixed type imports collapsing the lazy renderer boundaries; explicit `import type` declarations restored separate Bitmap, MTSDF, and Slug production chunks. The complete deterministic benchmark check and React Doctor remained clean, all 42 retained-scene cells passed with visible pixels and one renderer, and both 60-second timed demos traversed Advanced Shaping and returned to Off-axis / 3D with one renderer at 60.02 WebGPU and 60.36 forced-WebGL2 Icon Grid FPS.
