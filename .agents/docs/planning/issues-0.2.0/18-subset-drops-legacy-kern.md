---
type: Issue Record
title: 'Issue 18: a subset bake drops the legacy kern table'
description: "glyph bake --unicodes dropped a font's legacy kern table, so a font that kerns only through kern lost all kerning in a subset while a full bake kept it."
status: draft
sources:
  - id: source-font
    resource: ../../../../packages/glyph/rust/font-baker/src/source_font.rs
    title: Source font preparation
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-24T23:30:00Z'
---

# Issue 18: a subset bake drops the legacy `kern` table

- **Severity:** should-fix (fonts that kern only through `kern`, such as Times New Roman, Verdana, Trebuchet MS,
  Cherry Cream Soda and Syncopate, lose all kerning in every `--unicodes` bake)
- **Status:** fixed on `experiments/sil-subset`. Found by the shaper lane.

## What happens

A full bake keeps the source's legacy `kern` table in the shaping payload, so HarfRust kerns with it. A `--unicodes`
bake did not: `skera::DEFAULT_DROP_TABLES` lists `kern` (hb-subset drops it by default), and skera has no `kern`
subsetter, so the prepared font had none and the subset shaped with no kerning. Same code points, different advances.

## Reproduction

`packages/glyph/rust/font-baker/src/source_font.rs` test `a_subset_of_a_kern_only_font_kerns_like_a_full_bake` builds
Inter without GPOS and with a format 0 `kern` table holding `AV` and `To`, and requires an ASCII subset and a bake of
every code point to give both pairs the same kerning. Before the fix the ASCII subset had no `kern` table (and
renumbered glyph IDs). With the adversarial fonts (`glyph-adversarial-fonts`, not in the repository), shaping `AV To`
at 100 px on `sil-green-69`:

| font                         | full bake glyph x        | ASCII subset glyph x (before) |
| ---------------------------- | ------------------------ | ----------------------------- |
| Cherry Cream Soda            | 0 84.0 155.4 190.3 246.3 | 0 84.0 155.4 190.3 250.3      |
| Syncopate (kern-only, SYNTH) | 0 75.3 157.1 194.7 263.6 | 0 81.3 163.1 200.7 271.6      |

## Root cause and fix

skera cannot subset `kern` and does not expose its old-to-new glyph map, so the table cannot be remapped. The fix keeps
it whole, as the CFF path does: when the source has a legacy `kern` table, preparation retains source glyph IDs
(`SUBSET_FLAGS_RETAIN_GIDS`) and copies the source `kern` table into the prepared font. Every pair that names a kept
glyph stays valid; pairs naming dropped glyphs are never reached. After the fix the ASCII subsets shape exactly like the
full bakes (Cherry Cream Soda `0 84.0 155.4 190.3 246.3`, Syncopate `0 75.3 157.1 194.7 263.6`).

## Cost

Retained IDs add per-glyph metadata (glyph extents, raster records) for empty IDs below the highest kept glyph, and the
whole `kern` table travels. ASCII subset with Bitmap 16: Cherry Cream Soda 41,908 to 49,340 bytes (96 to 116 glyph
IDs), Syncopate 41,072 to 60,856 bytes (its 25 KB `kern` table). No repository font fixture has a legacy `kern` table,
so no committed artifact changed.
