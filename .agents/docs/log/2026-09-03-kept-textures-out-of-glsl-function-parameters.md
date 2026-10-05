---
type: Log Entry
title: 'Kept textures out of GLSL function parameters'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Bitmap's Three adapter now captures its array texture at the resource boundary and shares only the canonical bounded-texel coordinate helper with direct TypeGPU. Its emitted GLSL calls `texelFetch` without declaring TypeGPU's texture schema syntax as a function parameter, while WGSL retains the public resource-polymorphic coverage helper.
