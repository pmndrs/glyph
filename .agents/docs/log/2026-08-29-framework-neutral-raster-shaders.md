---
type: Log Entry
title: 'Framework-neutral raster shaders'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Moved Bitmap and MTSDF evaluation plus the analytic Slug fill algorithm into renderer-independent TypeGPU functions. The Slug core imports no renderer; neighboring TypeGPU modules own page texture reads and bounded band traversal, while the Three host supplies resources and node-valued glyph fields through `@typegpu/three`. Native TSL remains only for the writable varying and matrix-compatible dilation path. The benchmark comparison likewise computes its signed coverage heatmap through a plain-value TypeGPU function while retaining its native-TSL baseline.
