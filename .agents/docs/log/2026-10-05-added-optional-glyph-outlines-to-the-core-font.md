---
type: Log Entry
title: 'Added optional glyph outlines to the core font'
generated:
  by: process:docs-new
  at: '2026-10-05T20:03:24Z'
---

`glyph bake --outlines` keeps the face's own outline tables in `PMNDRS_font`, and the loader decodes every glyph when the
font loads. `text.withGlyphs((glyphs) => glyphs.outlineAt(index, target?))` returns em-space views, and
`text.glyphs().outlineAt(index)` and `Glyphs.outlineAt(index)` return owned contours, for a font of any raster format.
`Glyphs` is indexed by the layout glyph index alone (`sourceIndex` is gone, blanks stay with `drawn: false`), and
`DetachedGlyph` gained `fontId` and `glyphId`. Only an outlined bake writes `PMNDRS_font` version 1; plain bakes stay
version 0 and byte-identical, so no checked-in bake changed. See
[the glyph outlines decision](../planning/decisions/glyph-outlines.md), [the package reference](../packages/glyph.md#glyph-outlines),
and [the extension](../planning/extensions/PMNDRS_font/README.md).
