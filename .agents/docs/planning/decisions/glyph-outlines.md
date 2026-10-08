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
- **One detached index.** A split glyph reads its outline through `Glyphs.outlineAt(index)` and nowhere else on the
  Three side. `Glyphs` uses the layout glyph index of `text.glyphs()`, `withGlyphs`, and `GlyphPlacement.index`, with every
  per-glyph datum a parallel array at it and blank glyphs kept at their layout indices (user directive, 2026-10-07). A second
  `sourceIndex` would only name the same number, so `DetachedGlyph` and `ThreeGlyphMeasurement` do not carry one.
- **Three identities.** `index` is the position in this layout, `key` is the same occurrence across reflow (the shipped
  0.1.0 contract), and `fontHandle` plus `glyphId` are the same shape (user directive, 2026-10-08). `fontHandle` is a plain number
  consistent with the other glyph views; it retains nothing, and no public font-by-handle lookup is added.

## Consequences

The bake validator decodes every glyph with the runtime decoder, so the baker carries no outline drawing. Outlines stay
outside `shaping.fingerprint`. CFF2, variation axes, and a runtime-bake outline option are deferred, so a runtime bake
never has outlines.

Recorded in pull request #235 as register row D-371; the register froze at D-372 before it merged, so the decision lives
here instead.
