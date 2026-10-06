---
type: Log Entry
title: 'Dilated Slug quads half a pixel across each edge'
generated:
  by: process:docs-new
  at: '2026-10-06T15:14:14Z'
---

Slug vertex dilation moved each corner half a pixel along the normalized half-diagonal, so a quad of aspect `a` got
`0.5/√(1 + a²)` px of margin on its short axis and `0.5a/√(1 + a²)` px on its long axis. The margin did not depend on
font size: an em dash got 0.040 px vertically and a square glyph 0.354 px on both axes. Slug coverage reaches zero half a
pixel past a straight edge, so the quad clipped fringe pixels with up to 117/255 coverage on an em dash, 105/255 on an
underscore, 107/255 on a narrow `i`, and 37/255 on a square glyph. Quad edges also landed close to pixel centres, where
WebGPU and WebGL2 break rasterization ties differently.

The TypeGPU core, the native TSL `/shaders/tsl` graph, and the CPU reference mirror now scale the sign of the outward
normal, `(±1, ±1)` at a corner, by the analytic half-pixel step, as Lengyel's `SlugDilate` does. Each corner therefore
moves half a pixel across both adjacent edges under any orthographic transform and rotation. The public signatures are
unchanged, and callers that pass the corner offset from the quad centre get the corrected result. The narrowing came from
the July port of the Three Flatland shader (`f849c512`), whose test checked only the direction of the step. No decision
record chose it, and the autoresearch protocol lists a reduced antialiasing skirt as a rejected idea. Quad area over
Inter's Latin ink boxes grows by 10.7% at 12 px per em, 4.2% at 32, 1.1% at 128, and 0.3% at 512.

`tests/package/slug-dilation.test.mjs` checks the half-pixel margin on both axes and checks that no pixel with nonzero
core coverage falls outside the dilated quad. See [the package reference](../packages/glyph.md).
