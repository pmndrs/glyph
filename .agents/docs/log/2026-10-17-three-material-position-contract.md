---
type: Log Entry
title: 'Make Three material positions stage-safe and space-explicit'
generated:
  by: process:docs-new
  at: '2026-10-17T21:01:04Z'
---

Issue [#181](https://github.com/pmndrs/glyph/issues/181) exposed two material-authoring traps. The Slug position graph
publishes its analytic coverage varying as a vertex side effect, so reading the raw position from fragment colour code
generated an assignment to an immutable WGSL input. The existing material `position` also includes renderer transforms,
while the raw paragraph ink query does not. Normalizing one against the other shifted a word-wide texture or gradient.

Built-in Three material contexts now publish `paragraphPosition` in unanchored +Y-up paragraph coordinates and keep
`position` as the final renderer-local coordinate. Three's pinned `vertexStage()` varying wraps both nodes, so repeated
reads share the vertex computation and a fragment expression receives interpolation. The material factory remains
synchronous and the command-buffer ABI and ownership rules do not change. A factory may serve multiple Text objects,
so paragraph ink extents remain a per-Text query: `Text.glyphs().inkBounds` supplies the raw +Y-down extent before
material realization. The [Three material reference](../planning/three-api.md#define-a-material) shows the Y conversion,
a paragraph texture mapping, and a Slug displacement that reads position in both stages. The
[Glyph concept](../packages/glyph.md) records the two position spaces.

The focused integration test compiles a real Slug material on WGSL and GLSL and rejects a fragment assignment to the
coverage varying. The browser probe renders a translated, centered Slug paragraph through a composed material on
asserted WebGPU and WebGL2 backends. Both produced 1,699 interior ink pixels, with 518 left and 473 right oracle pixels
and maximum normalized UV error 0.00261 against independently queried ink bounds. Replacing `paragraphPosition` with
the transformed `position` failed the same oracle on the left ink; restoring it passed both backends. Browser console and
page errors fail the workflow. See `benchmark:material-position` for the repeatable lane.
