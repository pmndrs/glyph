---
type: Log Entry
title: 'Maintained TypeGPU engine boundary'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added the internal `@pmndrs/glyph/typegpu` subpath over the renderer-neutral runtime and pinned optional `typegpu` 0.11 peer. The retained engine accepts a caller-owned root and pass, preserves exact program variant/draw/revision types, delegates synchronization through ordinary paragraph-batch attachments, and keeps transforms plus visibility in target-owned sidecar state without shaping. The implementation exposed one gap in the planned program surface: font resources and pipeline/run compilation provided no operation for allocating or partially updating per-batch instance buffers. Replaced that incomplete method list with an exact program-owned `createTarget()` factory; the returned public target owns TypeGPU buffers, resources, pipelines, dirty writes, draw compilation, encoding, and retirement without changing core. Focused compile and runtime tests prove variant rejection, handle retention, non-shaping transform updates, staged replacement, and target disposal. The reviewed target-v1 checkpoint grows browser core by 23,341 raw / 16,601 minified / 4,942 gzip / 3,976 Brotli bytes and the shaper graph by 1,475 / 1,061 / 163 / 153; merged-v0 Bitmap, MTSDF, and Slug harness graphs each inherit the same 1,475 raw-byte shaper boundary while their compressed deltas remain 224/75, 220/180, and 223/177 gzip/Brotli bytes. Bitmap/MTSDF/Slug TypeGPU programs and live pixels remain open.
