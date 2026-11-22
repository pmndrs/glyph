---
type: Log Entry
title: 'Make Three material positions stage-safe and space-explicit'
generated:
  by: process:docs-new
  at: '2026-11-22T06:15:21Z'
---

Issue [#181](https://github.com/pmndrs/glyph/issues/181) exposed two material-authoring traps. Slug's position graph
assigns its coverage varying as a vertex side effect, so a custom material that read `context.position` from a fragment
node emitted an assignment to an immutable WGSL input. And `position` carries draw-space transforms that the paragraph
ink query does not, so normalizing one against the other shifted a word-wide texture or gradient.

This re-implements open PR #311 on the segment-indexed integration branch. Built-in Three material contexts now carry
`paragraphPosition` (unanchored paragraph-local, +Y up) beside the draw-local `position`. The PR wrapped each in
three.js `vertexStage()`. On this branch that wrapper, assigned to `material.positionNode`, lowers a TypeGPU-backed
Bitmap or decoration graph's `positionLocal` to `null.xy` and an empty argument in WebGL2 GLSL in direct transform mode.
Each node is therefore a private stage-selecting node: the raw vertex graph in the vertex stage, and a `vertexStage()`
varying of it in the fragment stage. A pass-through custom material compiles to the default vertex program. The default
material still receives the raw graph and the realizer constructs neither node for it; all 32 default Bitmap and Slug
WGSL/GLSL stage sources (stable and TypeGPU, direct and indexed) are byte-identical before and after. MSDF quad trimming
remains default-only, so a factory sees the whole atlas cell. The
[Three material reference](../planning/three-api.md#define-a-material) documents stage, arity, space, displacement,
paragraph texture mapping, inspection bounds and quad extent; the [Glyph concept](../packages/glyph.md) records the
node boundary.

Integration tests compile Bitmap, MSDF, Slug and decoration custom materials that displace `position` and read both
nodes in the fragment stage, for both shader sets and transform modes, and reject a fragment assignment to Slug's
varying or a lost GLSL builtin. Before the fix the four Slug compilations failed on the assignment; the plain
`vertexStage()` wrapper failed the three TypeGPU direct-mode groups on the decoration and Bitmap draws.
`benchmark:material-position` ports the PR's 16-case pixel proof and adds a `fragment-gradient` case: a paragraph-space
(u, v) gradient on Slug read only in the fragment stage. All 24 runs pass on WebGPU and WebGL2. Undisplaced composed
runs have 1,420 oracle ink pixels and a maximum u error of 0.00263, displaced runs stay below 0.0079, and the gradient
has u error 0.00263 and v error 0.00537 over 1,280 pixels. Against the unfixed realizer, the gradient case (reading
`position`, the only node it had) failed on WebGPU with `cannot assign to parameter 'pmndrsSlugRenderCoordinate'`
and drew no ink.
