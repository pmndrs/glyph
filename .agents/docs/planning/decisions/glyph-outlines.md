---
type: Decision
title: 'Glyph outlines are optional core-font data shared by every raster technique'
description: 'Glyph outlines are optional core-font data that every raster technique shares, not a Slug-only read of GPU curves.'
decision_status: Accepted
decided: '2026-09-23'
generated:
  by: human:krispya
  at: '2026-10-05T20:02:16Z'
---

# Glyph outlines are optional core-font data shared by every raster technique

## Decision

Glyph outlines are optional core-font data that every raster technique shares, not a Slug-only read of GPU curves.
`glyph bake --outlines` (Node `font.outlines`) keeps the face's own outline tables in one `PMNDRS_font.outlines` buffer
view; its presence is the flag. `PMNDRS_font` version 1 marks a font that carries outlines, a bake without them still
writes version 0, and readers accept both. The format, read paths, and decoder are in the
[package reference](../../packages/glyph.md#glyph-outlines).

- **Decode at load.** The loader decodes every glyph behind the load promise into one store the font owns, so every read
  is plain data. Decoding on first read was rejected: a `glyphs()` copy then depended on the font's engine registration
  and could decode inside a borrowed render plan (maintainer, 2026-10-07). There is no load option, and a read throws
  when the font has no outlines; outlines are optional today and planned to become required.
- **Em space.** An outline is the shape of a glyph ID in a font, in em units with y down and the origin at the pen
  position on the baseline, so equal font and glyph IDs give equal outlines. Borrowed reads return a plain
  `GlyphOutlineView` and owned reads return `[x0, y0, cx, cy, x1, y1, isLine]` contours (agreed on the pull request,
  2026-10-06). The view names its font `fontHandle`, matching `BorrowedGlyph.fontHandle` and `glyphs().fontHandles`;
  `DetachedGlyph` uses the same `fontHandle` name.
- **Drawable detached indices.** `Text.breakApart()` returns only glyphs with render records, excluding spaces and
  other blank layout glyphs (user directive, 2026-10-08). `Glyphs` indices are dense over the drawable subset:
  `count`, `glyphAt`, `measurements`, `outlineAt`, and matrix methods all use that index. A private mapping preserves
  the original layout index for outline reads; no public `sourceIndex` or `drawn` flag is needed. Full layout inspection
  continues to include blank glyphs for shaping and layout.
- **Three identities.** `index` is the position in the detached drawable subset, `key` is the same occurrence across reflow (the shipped
  0.1.0 contract), and `fontHandle` plus `glyphId` are the same shape (user directive, 2026-10-08). `fontHandle` is a plain number
  consistent with the other glyph views; it retains nothing, and no public font-by-handle lookup is added.

## Consequences

The bake validator decodes every glyph with the runtime decoder, so the baker carries no outline drawing. Outlines stay
outside `shaping.fingerprint`. CFF2, variation axes, and a runtime-bake outline option are deferred, so a runtime bake
never has outlines.

Recorded in pull request #235 as register row D-371; the register froze at D-372 before it merged, so the decision lives
here instead.
