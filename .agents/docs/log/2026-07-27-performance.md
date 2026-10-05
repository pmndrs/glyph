---
type: Log Entry
title: 'Performance'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Recorded an explicit 1× WebGPU Paint & Effects baseline that separates first-draw CPU submit, first GPU frame with atlas upload, steady CPU/GPU frames, FPS, font/GPU bytes, and exact isolated core/shaper/runtime/optional-baker sizes. Paint & Effects remains one workload with animated per-word hue, opacity slider, and an MSDF-only stroke slider that stays visibly disabled for Bitmap.
