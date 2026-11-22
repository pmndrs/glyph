---
type: Log Entry
title: 'Added replace to the PixiJS 3D text'
generated:
  by: process:docs-new
  at: '2026-11-22T06:00:46Z'
---

`Pixi3DText.replace(start, end, insert)` joins the five editing queries on the PixiJS 3D text. It is the host call
Three `Text` and TypeGPU text already use (`GlyphTextController.editing.beginReplace` then `replaceInText`), so the
engine checks the range and throws `TextOffsetError`, the planner is told the stated range, and spans are rebased by
the shared rule. `@pmndrs/glyph/pixi3d` now exports `TextOffsetError` and the editing types its signatures use, as
`/three` does. `tests/package/pixi3d-editing.test.mjs` checks that a PixiJS 3D text and a Three text given the same
content and edits report equal carets at every offset and affinity, that refused offsets throw the same error and
change nothing, and that every case of `tests/fixtures/span-rebase-vectors.json` holds on a PixiJS 3D text in both the
host spans and the engine's shaped sizes. See [the glyph package](../packages/glyph.md).

While verifying inline objects for 0.2.0, no public entry accepted one: the input exists only on the internal render
planner (`RetainedTextInlineObjectInput`), and no public layout result reports an object's box. Inline objects
therefore stay undocumented as an application feature until a decision adds that surface.
