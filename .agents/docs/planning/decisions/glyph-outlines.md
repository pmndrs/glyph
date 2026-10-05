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
`text.withGlyphs((glyphs) => glyphs.outlineAt(index))` decodes one laid-out glyph in the text shaper from the font that
shaped it, placed in paragraph space at its size and origin, through read-fonts, which HarfRust already links: TrueType
follows Skrifa's FreeType-style unscaled loader, CFF uses read-fonts' charstring evaluator, and each cubic becomes four
equal-parameter quadratics through Slug's split.

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
stay outside `shaping.fingerprint`. CFF2, variation axes, and a runtime-bake outline option are deferred.

Recorded in pull request #235 as register row D-371; the register froze at D-372 before it merged, so the decision lives
here instead.
