---
type: Log Entry
title: 'Detached glyph outlines and a per-load outline option'
generated:
  by: process:docs-new
  at: '2026-10-07T14:30:06Z'
---

`Text.breakApart()` split glyphs had no way to read their outlines, although the owned inspection their placements came
from already carries them. `Glyphs.outlineAt(index)` now answers from that retained inspection by the dense
`DetachedGlyph.index`, and reads after a re-layout of the source or disposal of the font. `FontLoadOptions.outlines`
(`'auto'`, `'skip'`, `'require'`) lets one load skip decoding outlines or demand them; `'require'` rejects with the new
`GlyphFontError` reason `FONT_OUTLINES_UNAVAILABLE`, loads that differ only in the mode converge on one font that only
gains outlines, and a read of a skipped font says so instead of claiming the font was baked without outlines. The
[Glyph outlines concept](../packages/glyph.md#glyph-outlines) and the
[decision](../planning/decisions/glyph-outlines.md) describe the shape.
