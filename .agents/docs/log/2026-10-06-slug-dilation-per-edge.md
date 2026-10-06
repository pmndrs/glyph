---
type: Log Entry
title: 'Dilated Slug quads half a pixel across each projected edge'
generated:
  by: process:docs-new
  at: '2026-10-06T21:18:11Z'
---

[The half-pixel dilation fix](2026-10-06-slug-dilation-half-pixel-per-axis.md) scaled the `(±1, ±1)` corner by one
step, solved for half a pixel along the normalized diagonal, as Lengyel's `SlugDilate` does. That gives half a pixel per
edge only when both quad axes have the same screen scale. A post-merge review of #256 found that a 4× horizontal stretch
left the narrow `i` 0.171 px past its horizontal edges, against 0.421 px before #256, and a plane tilted 70° in
perspective left 0.230 px. Coverage is measured per axis, so the fringe needs 0.5 px on each.

The TypeGPU core, the native TSL graph, and the CPU reference mirror now solve each axis's step from the corner's screen
tangents and the w row. Stepping along one quad axis moves the corner along the other edge's projected line, so the screen
distance past the edge it crosses has a closed form; solving both axes for half a pixel gives one shared denominator,
exact under any projective transform. Towards the horizon the exact steps grow without bound, so the denominator is held
at half the tangent area, at most twice the affine steps, with a floor that keeps an edge-on plane finite. Uniform scale
and rotation give the same quad as #256. The vertex cost is about ten more multiply-adds per corner, with the same
square-root and divide count; quad area and GPU time were not measured.

`tests/package/slug-dilation.test.mjs` now measures each margin as the screen distance from the projected edge line and
checks uniform, rotated, 4× stretched, sheared, and perspective transforms at 1e-4 px, plus a finite result for an
edge-on plane. See [the package reference](../packages/glyph.md).
