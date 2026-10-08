---
type: Log Entry
title: 'Detached glyph outlines and a per-load outline option'
generated:
  by: process:docs-new
  at: '2026-10-07T14:30:06Z'
---

`Text.breakApart()` split glyphs had no way to read their outlines, although the owned inspection their placements came
from already carries them. `Glyphs.outlineAt(index)` now answers from that retained inspection, and `Glyphs` is indexed by
the layout glyph index alone (`count` is the layout's glyph count, blanks stay with `drawn: false`, `sourceIndex` is
gone). A per-load outline option was tried and removed before release: a font decodes its outlines when it loads if it
has them, a read throws when it has none (by design for now), and outlines are planned to become required. `DetachedGlyph` also gained `fontId` and `glyphId`, so a caller can tell `index` (position), `key` (occurrence)
and the shape apart. The
[Glyph outlines concept](../packages/glyph.md#glyph-outlines) and the
[decision](../planning/decisions/glyph-outlines.md) describe the shape.
