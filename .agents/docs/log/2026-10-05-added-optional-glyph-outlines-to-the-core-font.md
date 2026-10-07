---
type: Log Entry
title: 'Added optional glyph outlines to the core font'
generated:
  by: process:docs-new
  at: '2026-10-05T20:03:24Z'
---

`glyph bake --outlines` keeps the face's own `glyf`/`loca` or
`CFF ` table in `PMNDRS_font`, and a Text's `withGlyphs` view decodes any laid-out glyph with `outlineAt(index)` in the
text shaper through read-fonts, for a font of any raster format. Only an outlined bake writes `PMNDRS_font` version 1;
plain bakes stay version 0 and byte-identical, so no checked-in bake changed. See
[the glyph outlines decision](../planning/decisions/glyph-outlines.md), [the package reference](../packages/glyph.md), and
[the extension](../planning/extensions/PMNDRS_font/README.md).
