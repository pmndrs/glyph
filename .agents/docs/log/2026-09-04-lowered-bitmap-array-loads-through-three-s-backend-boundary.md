---
type: Log Entry
title: "Lowered Bitmap array loads through Three's backend boundary"
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The Three adapter now delegates its physical texel load to the installed TSL `textureLoad(...).depth(...)` node. WebGL therefore receives `texelFetch` with an `ivec3(x, y, layer)` coordinate and explicit LOD, while WebGPU retains its native array-texture load. Canonical TypeGPU helpers still own bounded coordinate resolution and paint.
