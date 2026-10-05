---
type: Log Entry
title: 'Passed the complete foundation gate and refreshed release evidence'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The exact pushed foundation commit passes
158 Rust library tests, 165 Node integration tests, unchanged Unicode 17 vectors, 112 benchmark-app tests, all 16
isolated Chromium targets,
production builds, the R3F live GPU interaction, formatting, lint, types, packaging, and OKF validation. Sequential
eight-warmup/31-sample 25,515-positioned-glyph runs put Bitmap/MTSDF/Slug cold medians at 16.02/16.60/16.83 ms,
font-size at 6.01/6.42/6.67 ms, column width at 2.77/2.77/2.87 ms, and suffix edits at 13.73/13.75/13.59 ms. Every
comparable median beats the retained TypeScript checkpoint; the p95-under-4-ms optimization target remains open.
The live 11,510-glyph Paragraph Stress probe holds one draw and 121 RAF FPS while attributing 5.725/7.405 ms
median/p95 to public text update-and-measure versus 0.405/0.905 ms for renderer submission.
