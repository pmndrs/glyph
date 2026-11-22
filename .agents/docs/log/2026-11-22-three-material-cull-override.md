---
type: Log Entry
title: 'Caller materials are culled with a declared padding; frustumCulled opts out'
generated:
  by: process:docs-new
  at: '2026-11-22T09:19:30Z'
---

The owner rejected leaving every caller-material draw unculled. A draw whose material comes from a
`defineTextMaterial` factory is now frustum culled with the same computed bound as a built-in draw
([glyph](../packages/glyph.md), [Three API](../planning/three-api.md)). The material declares its reach with
`defineTextMaterial(create, { boundsPadding })`, in the units of `context.position`, and Glyph grows each draw's bound
by it; `{ frustumCulled: false }` never culls its draws. External raster programs and supplied geometry stay unculled.
Three's own `frustumCulled = false` on a `Text`, an enclosing `TextGroup` or a `Glyphs` makes the draws placing its
records report an unbounded sphere, so a batch with one such member is drawn whole. Both are new public API listed for
the owner in [the API summary](../planning/api-summary-for-review.md).

`benchmark:frustum-culling` gained the proof on WebGPU and WebGL2, indexed and direct: 38 pixel-identical cases with a
200-unit displacement declared as its padding, a sweep with half that padding that culling visibly breaks (the
negative control), a `frustumCulled: false` material drawn from off-screen, and draw calls kept off-screen for a batched
member, a standalone Text, a TextGroup and a detached Glyphs.
