---
type: Log Entry
title: 'Async retained scene transitions'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Gave each route and backend generation one persistent canvas, renderer, animation loop, GPU timer, and telemetry history. Workload and technique selections preload through a React resource, commit inside a transition after the async boundary, keep the current scene visible while the replacement activates, and let the nearest Suspense boundary own genuinely cold loading. Compatible font changes update retained `Text` instances in place. The realtime MSDF / Slug comparison now borrows that host as a retained scene, while finite Bitmap, MTSDF, Slug, source-outline, and runtime-fallback captures borrow it as exclusive jobs that restore renderer state after success or failure. A live WebGPU probe changed Slug to MSDF in 15 animation frames while preserving the renderer canvas and all three graph canvases without exposing either loading UI; Off-axis / 3D to Icon Grid preserved the same canvas and settled in 14 frames.
