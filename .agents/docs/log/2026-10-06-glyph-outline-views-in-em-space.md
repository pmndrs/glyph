---
type: Log Entry
title: 'Outlines read as em-space views and owned tuples'
generated:
  by: anthropic/claude-code
  at: '2026-10-06T21:07:16Z'
---

`outlineAt()` now describes a glyph in em units with y down and the origin at its pen position on the baseline, instead
of in paragraph space at its size, so equal font and glyph IDs give equal outlines. Inside `withGlyphs`,
`outlineAt(index, target?)` returns a plain `GlyphOutlineView` of endpoint-shared `points`, `contourEnds`, and
`segmentLines` views over the shaper's decode result, valid only for the callback; `text.glyphs().outlineAt(index)`
returns caller-owned `[x0, y0, cx, cy, x1, y1, isLine]` contours built from the same view. The shaper's decoder writes
that layout directly, and the stored `glyf`/`loca`/`CFF ` outline SFNT is unchanged. See
[the glyph outlines decision](../planning/decisions/glyph-outlines.md) and [the package reference](../packages/glyph.md).
