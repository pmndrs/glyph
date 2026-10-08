---
type: Log Entry
title: 'Exported canonical technique shaders'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Target-v1's Three targets each built their node graph inline, so a third party that registered its own program had to reimplement Bitmap's atlas sampling, MTSDF's median decode and screen-space range, or Slug's band walk to change anything about the final output. Extracted each graph into `bitmapShader`, `mtsdfShader`, and `slugShader`, exported from `/three` beside `registerThreeRasterProgram`, and made the first-party targets consume those same functions rather than a parallel copy: the export cannot drift from what renders because deleting it breaks `ThreeBitmapTarget`, `ThreeMtsdfTarget`, and `ThreeSlugTarget`. Each takes one instance's resolved nodes plus that batch's bound resources and returns a named readonly output including the intermediate coverage stages a composition needs. `registerThreeRasterProgram` now infers its technique so a program can type its prepared batches, storage, and binding concretely, replacing the three erasing casts the first-party registrations previously required. Rendering is unchanged: Bitmap, MTSDF, and Slug still compile one draw with 1,226, 1,935, and 1,510 lit pixels on native WebGPU and forced WebGL2 with retained draw and storage identity. A new browser proof renders one paragraph through the pre-registered Bitmap program and then through a third-party program that owns its own attributes, geometry, and material and composes only its final colour over `bitmapShader`; both light the same 1,243-pixel set while the composed pass emits no green channel, so composition inherited the canonical placement and coverage instead of reproducing them.
