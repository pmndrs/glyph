---
type: Issue Record
title: 'Issue 03: glyph bake --unicodes loses the outlines of every CFF font'
description: "skera 0.5.1 has no CFF/CFF2 subsetter and silently omits the table, so a --unicodes bake of any CFF-flavoured OpenType font fails in the raster baker with 'font has no glyf, CFF, or CFF2 outline table'."
status: draft
sources:
  - id: source-font
    resource: ../../../../packages/glyph/rust/font-baker/src/source_font.rs
    title: Unicode subset preparation
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-24T16:05:00Z'
---

# Issue 03: `glyph bake --unicodes` loses the outlines of every CFF font

- **Severity:** ship-blocker (CFF sources are documented as supported; CJK fonts, the main reason to subset, are CFF)
- **Status:** open

## What happens

```sh
glyph bake --input NotoSansCJKjp-Regular.otf --unicodes U+0020-007E,U+3040-309F --bitmap 16
# BitmapBakeError: font has no glyf, CFF, or CFF2 outline table to rasterize
```

The same bake without `--unicodes` works. Found by the hero on NotoSansCJKjp (CID-keyed); it is not CID-specific: the
name-keyed `benches/fixtures/fonts/dancing-script-3.000/DancingScript-Regular.otf` fails the same way. A bake that
selects no raster (shaping only) does not fail; it silently produces a font with no outlines.

## Root cause

`source_font.rs:78-132` subsets with skera 0.5.1. skera's `subset_table` (`skera-0.5.1/src/lib.rs:1235-1387`) has no
`CFF ` or `CFF2` arm; with `SubsetFlags::default()` an unrecognized table falls to `_ => Ok(())` and is left out, and
`subset_font` returns success. The raster bakers then reject the outline-less font
(`rust/bitmap-baker/src/rasterize.rs:146`, `rust/mtsdf-baker/src/artifact.rs:362`, `rust/slug-baker/src/artifact.rs:169`).

## Options considered

1. **Fail early with a clear error.** Honest, but leaves CFF fonts unsubsettable.
2. **`PASSTHROUGH_UNRECOGNIZED`.** Wrong: glyph IDs are renumbered, so the copied CharStrings no longer match.
3. **Retain glyph IDs for CFF/CFF2 sources and copy the source outline table.** With `SUBSET_FLAGS_RETAIN_GIDS` skera
   keeps every selected glyph at its source ID (`lib.rs:625`), so the unmodified `CFF `/`CFF2` table stays valid for
   every glyph the subset keeps. Glyph-ID-indexed tables (`hmtx`, `cmap`, GSUB/GPOS) are still subset; `maxp`
   counts up to the highest kept glyph.
4. **Write a CFF subsetter / upgrade skera.** No skera release with one exists at the pinned version; writing one is
   a project of its own.

## Chosen fix

Option 3 now, option 4 later. The prepared font is correct for every glyph it keeps; the unsubset charstrings cost
size (a CJK subset still carries every outline in `CFF `), but rasters only contain the selected glyphs, which is where
the bake's output size goes. `write-fonts` (already linked through skera) assembles the subset tables plus the source
outline table.

## Test that will prove it

- Rust (`source_font.rs` tests): subset NotoSansCJKjp (CID-keyed) and DancingScript (name-keyed) and assert the prepared
  font still has an outline format and that a selected code point maps to a glyph with a non-empty outline.
- Integration (`tests/integration/node-bake.test.mjs`): `glyph bake --unicodes … --bitmap 16` on the DancingScript OTF
  succeeds.

## Risk

- Behaviour: CFF subset bakes now succeed; glyph IDs in CFF subsets equal source IDs (TrueType subsets unchanged).
- API: none. Performance: one extra table copy at bake time. Size: CFF subset sources are larger than a true CFF
  subset would be; the baker Wasm grows by the `FontBuilder` path only if skera had not already linked it.
