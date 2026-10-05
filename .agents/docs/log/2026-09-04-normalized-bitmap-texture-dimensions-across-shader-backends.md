---
type: Log Entry
title: 'Normalized Bitmap texture dimensions across shader backends'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

GLSL reports an array texture's size as signed `(width, height, layers)`, while WGSL reports only an unsigned `(width, height)`. The shared bounds helper now accepts a two-component float extent, so Three can discard GLSL's layer count and normalize WGSL's unsigned result before the TypeGPU bridge; each resource boundary converts the bounded coordinate to the integer type its texel load requires.
