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
`glyph bake --outlines` (Node `font.outlines`) keeps the face's own `glyf`/`loca` or `CFF ` table unchanged in an outline
SFNT beside `head` and `maxp`, stored as one `PMNDRS_font.outlines` buffer view; the object's presence is the flag, and
bakes without it are unchanged. `PMNDRS_font` version 1 marks a font that carries outlines; a bake without them still
writes version 0, byte-identical to earlier bakes, and readers accept both.
The loader decodes every glyph when the font loads, behind the load promise where the artifact fetch already dominates,
into one store the font owns; reads are then plain data. It decodes through the text shaper's read-fonts decoder,
which HarfRust already links: TrueType follows Skrifa's FreeType-style unscaled loader, CFF uses read-fonts' charstring
evaluator, and each cubic becomes four equal-parameter quadratics through Slug's split. Decoding when a glyph was first
read was rejected because a `glyphs()` copy then depended on the font's engine registration and could decode inside a
borrowed render plan (maintainer, 2026-10-07). Outlines are in em units with y down and the origin
at the glyph's pen position on the baseline, so equal font and glyph IDs give equal outlines; a caller places them with
the layout's `x`, `y`, and `fontSize`. `text.withGlyphs((glyphs) => glyphs.outlineAt(index, target?))` returns a plain
`GlyphOutlineView` of endpoint-shared `points`, `contourEnds`, and `segmentLines` views that expire with the callback,
and `text.glyphs().outlineAt(index)` returns caller-owned `[x0, y0, cx, cy, x1, y1, isLine]` contours. A line keeps its
midpoint control in both. This API was agreed on the pull request on 2026-10-06 and replaced a paragraph-space,
tuple-only `outlineAt()` before release.

A split glyph reads its outline through `Glyphs.outlineAt(index)` and nowhere else on the Three side. `breakApart()`
already holds the owned inspection the placements came from, so `Glyphs` keeps it and returns
`text.glyphs().outlineAt(index)`. `Glyphs` uses one index, the layout glyph index (`text.glyphs()`, `withGlyphs`,
`GlyphPlacement.index`), and every per-glyph datum is a parallel array at it (user directive, 2026-10-07): `count` is
the layout's glyph count, blank glyphs stay in the index space with `drawn: false`, and `DetachedGlyph.sourceIndex` and
`ThreeGlyphMeasurement.sourceIndex` are removed because they would only name the same number. The outline is data like
`glyphAt`, so it reads after the source re-lays out and after the font or the `Glyphs` object is disposed.

A missing outline at read time is by design: outlines are optional, so every read of a font without them throws, and
the message says whether the font was baked without outlines or its load skipped them. A caller that needs outlines
asks at load time with `outlines` on the font source, set beside `baked`: `'auto'` (default) decodes them when present, `'skip'` decodes and
retains nothing, and `'require'` rejects with the new `GlyphFontError` reason `FONT_OUTLINES_UNAVAILABLE`. Outlines are
only ever added to a font across loads: a later `'auto'` or `'require'` attaches them to a font an earlier `'skip'`
left without, and a later `'skip'` removes nothing.

## Why

Source tables replaced a decoded-quadratic payload that added 3 to 12 times the source font and could not bake Noto
Sans CJK JP within the 64 MiB limit; outlines now add 0.46 to 0.94 times. Skrifa was rejected as the runtime decoder
because its outline drawing adds 97 KB gzip to the shaper and cannot be trimmed by feature; the read-fonts decoder adds
24.7 KB gzip.

Implemented with a glyph-by-glyph Skrifa oracle over nine fixture faces and derived composites, composite work-bound
and corruption tests, validator cases, and Three Text tests against layout ink boxes, font-stack fallback, and Wasm
memory growth inside a borrow.

## Consequences

The bake validator decodes every glyph with that runtime decoder, so the baker carries no outline drawing. Outlines
stay outside `shaping.fingerprint`. CFF2, variation axes, and a runtime-bake outline option are deferred, so a runtime
bake never has outlines and `'require'` rejects for it. `glyph.fontFace()` accepts only the canonical source (URL,
`Blob`, `SerializedFontFace`), so it loads with `'auto'`; the option is on the source object that `loadFont` and
`FontLibrary.loadFont` take, which is not a public subpath, so an application reaches `'skip'` and `'require'` only
when `fontFace` accepts a source object.

Recorded in pull request #235 as register row D-371; the register froze at D-372 before it merged, so the decision lives
here instead.
