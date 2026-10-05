---
type: Log Entry
title: 'Recovered paragraph batching without rank-packed glyph keys'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Compatible spans and grouped paragraphs again
coalesce by resource, material, and fixed paint layer. `Text.renderOrder` ranks paragraphs only inside a `TextGroup`,
while group and standalone Text render order remain Three draw-mesh state. Rank-only changes publish one lifecycle
permutation without semantic or measurement payloads. The complete Bitmap/MSDF/Slug WebGPU/WebGL2 matrix restored
Icon Grid from 476 to 2 draws and Rich Text from 36 to 5 without changing the other workloads' 1–3 draw envelopes.
