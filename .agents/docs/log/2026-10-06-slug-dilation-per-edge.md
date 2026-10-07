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
without rotation gives the same quad as #256. Quad area and GPU time were not measured.

A second review found that the half-pixel target itself is too small off the screen axes. Coverage takes each em
axis's pixel scale from `fwidth`, |∂/∂x| + |∂/∂y|, so the fringe past an edge is `0.5 · (|t.x| + |t.y|) / |t|` pixels for
an edge whose screen direction is `t`: 0.683 px at 30°, which the package core confirms. With a 0.5 px margin, a 30°
rotation, with or without the 4× stretch, clipped fringe pixels of coverage 0.125. The steps now target that fringe. In
the closed form the edge length cancels, so they need the L1 norm of each tangent and no square root: the vertex
cost is about ten more multiply-adds per corner than #256, with one divide instead of two square roots and a divide. The em
coordinate across an edge is constant along it, so its gradient stays perpendicular to the edge and the target is exact
under perspective too. Uniform, unrotated views give the same quad as before.

`tests/package/slug-dilation.test.mjs` now measures each margin as the screen distance from the projected edge line and
checks it against that fringe at 1e-4 px under uniform, rotated 30°, 4× stretched, sheared, 4× stretched and rotated
30°, and perspective transforms, plus a finite result for an edge-on plane. A second test evaluates the package core
with `fwidth`-derived pixel scales under every affine case and checks that no covered pixel falls outside the dilated
quad. Both fail with the half-pixel target. See [the package reference](../packages/glyph.md).
