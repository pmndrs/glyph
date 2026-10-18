---
type: Log Entry
title: 'Make Three material positions stage-safe and space-explicit'
generated:
  by: process:docs-new
  at: '2026-10-17T21:01:04Z'
---

Issue [#181](https://github.com/pmndrs/glyph/issues/181) exposed two material-authoring traps. The Slug position graph
publishes its analytic coverage varying as a vertex side effect, so reading the raw position from fragment colour code
generated an assignment to an immutable WGSL input. The existing material `position` includes draw-space transforms,
while the raw paragraph ink query does not. Normalizing one against the other shifted a word-wide texture or gradient.

Built-in Three material contexts now publish `paragraphPosition` in unanchored +Y-up paragraph coordinates and keep
`position` as the final draw-local coordinate. Three's pinned `vertexStage()` varying wraps the context nodes, so
repeated reads share the vertex computation and a fragment expression receives interpolation. The default material
instead uses the raw vertex position graph. A controlled main-code substitution proved that feeding the stage wrapper
to a TypeGPU-backed default material generated invalid GLSL on WebGL2 (`null.xy` and an empty vertex argument); restoring
the raw default vertex graph passed the full Bitmap, MTSDF, Slug, and composed proof on both backends. The material
factory remains synchronous and the command-buffer ABI and ownership rules do not change. A factory may serve multiple
Text objects, so paragraph ink extents remain a per-Text query: `Text.glyphs().inkBounds` supplies the raw +Y-down
extent before material realization. The [Three material reference](../planning/three-api.md#define-a-material) shows
the Y conversion, a paragraph texture mapping, and a Slug displacement that reads position in both stages. The
[Glyph concept](../packages/glyph.md) records the two position spaces and direct/indexed draw-local distinction.

The focused integration tests compile a real Slug material on WGSL and GLSL, reject a fragment assignment to the
coverage varying, and reject invalid TypeGPU-backed Bitmap or decoration vertex arguments in direct and indexed modes.
The browser probe renders a center-anchored Slug paragraph under a rotated, nonuniformly scaled ancestor through a
composed material in direct and indexed transform modes, with and without displacement. Stable TSL and TypeGPU shaders
each passed WebGPU and WebGL2: the undisplaced cases produced 1,420 interior ink pixels with a maximum normalized UV
error of 0.00302 against independently queried ink bounds and an inverse authored world transform. Displaced cases
stayed below 0.00801, and direct/indexed ink counts differed by at most one. Replacing `paragraphPosition` with the
transformed `position` failed the same oracle on the left ink; restoring it passed. Browser console and page errors fail
the workflow. See `benchmark:material-position` for the repeatable lane.
