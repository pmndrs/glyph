---
type: Log Entry
title: 'Let Slug materials integrate coverage at a chosen coordinate'
generated:
  by: process:docs-new
  at: '2026-10-13T02:22:03Z'
---

Added `coverageAt(coordinate)` to the Slug material shader output in `/three` and `/three/typegpu`. It evaluates the
same analytic integral as `coverage` at an em-space coordinate the material computes, so a material can bend the
letterform itself, not only the quad, by integrating at the inverse of a warp. `coverage` is now
`coverageAt(renderCoordinate)` in both configurations. The canonical integral, its fill rule, and the material context
are otherwise unchanged; raw TypeGPU hosts already pass their own coordinate to `slugRender()`. See the
[Glyph package contract](../packages/glyph.md) and the
[material reference](../planning/three-api.md#slug-coverage-at-a-coordinate).

The compose stage of `benchmark:v1-bitmap` now draws an Inter Slug label three ways in Chromium 149 on WebGPU and WebGL2,
for both configurations: the default material lit 1,504 pixels, `coverageAt(renderCoordinate)` matched it in every
RGBA byte, and a coordinate two em past every outline lit none. A negative control that made the TSL implementation
ignore its coordinate lit all 1,504 pixels and failed the stage. Compiling one material that reads both `coverage` and
`coverageAt()` shared one emitted integral in `/three/typegpu`; `/three` inlined two, doubling the fragment source and
logging 49 Three variable-rename warnings per backend, which the material reference records as a cost of that use.
