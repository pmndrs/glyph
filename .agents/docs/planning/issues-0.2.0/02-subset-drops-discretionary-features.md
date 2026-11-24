---
type: Issue Record
title: 'Issue 02: a subset bake drops discretionary OpenType features'
description: "glyph bake --unicodes keeps only skera's default layout-feature list, so smcp, onum, tnum, zero, ssXX and their alternate glyphs are removed from the prepared font."
status: draft
sources:
  - id: source-font
    resource: ../../../../packages/glyph/rust/font-baker/src/source_font.rs
    title: Unicode subset preparation
  - id: node-bake-test
    resource: ../../../../packages/glyph/tests/integration/node-bake.test.mjs
    title: Node bake integration tests
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-24T16:05:00Z'
---

# Issue 02: a subset bake drops discretionary OpenType features

- **Severity:** ship-blocker (every documented app bake uses `--unicodes`; `fontFeatures` silently does nothing on it)
- **Status:** open

## What happens

Text styled with `fontFeatures` such as `smcp`, `onum`, `tnum`, `zero` or `ss01` shapes with the default glyphs when the
font was baked with `--unicodes`. Without `--unicodes` the same text uses the alternates. Found by the docs site.

## Reproduction

Subset Source Serif 4 (`benches/fixtures/fonts/source-serif-4.005/SourceSerif4-Regular.ttf`, which has `smcp`,
`c2sc`, `onum`, `tnum`, `zero`, `ss01`) to `U+0020-007E` with the font baker's `prepare_font` and read the subset's
GSUB feature list: none of those tags survive, and the alternate glyphs (`a.sc`, `one.tf`, …) are not in the subset.

## Root cause

`packages/glyph/rust/font-baker/src/source_font.rs:93-96` builds the subset plan's feature set from
`skera::DEFAULT_LAYOUT_FEATURES`, a port of hb-subset's default list (`rvrn ccmp liga locl mark mkmk rlig frac numr dnom
calt clig curs kern rclt`, vertical, and complex-script features). skera's GSUB closure
(`skera-0.5.1/src/gsub.rs:96`) walks only lookups reachable from those features, so discretionary alternates are never
added to the glyph set and their feature records are pruned. Scripts are already kept in full (lines 91-92); features
are not.

## Options considered

1. **Keep every feature** (hb-subset `--layout-features='*'`): invert an empty set, as for scripts.
2. **Union a fixed list of discretionary tags** into the default set. Smaller output, but any tag not on the list
   (`cv01`, `salt`, `swsh`, a foundry-specific `ss20`) is still silently dropped.
3. **Let the caller name the features to keep.** A new CLI/API option; Justin wants the smallest public surface, and
   the default would still be wrong.

## Chosen fix

Option 1. `fontFeatures` accepts any tag, so the prepared font must keep every feature the source has; a subset is a
code-point selection, not a feature selection. The cost is the alternates of the selected code points, which is what a
caller of `fontFeatures` needs.

## Test that will prove it

- Rust (`source_font.rs` tests): subset Source Serif 4 to ASCII and assert the GSUB feature list still contains
  `smcp`, `onum`, `tnum`, `zero` and `ss01`, and that the subset has more glyphs than the cmap-only closure.
- The committed `--unicodes` app assets (`apps/r3f-hello-world/assets/*.font.glb`,
  `apps/typegpu-hello-world/assets/inter-latin.font.glb`) are rebaked with their own `bake:*` scripts, explained by
  this change; their `bake:check` scripts prove the rebake is deterministic.

## Risk

- Behaviour: subset fonts gain alternates; glyph IDs inside a subset may shift (they are renumbered in source order).
  Nothing public exposes subset glyph IDs across bakes.
- API: none.
- Performance/size: subset fonts grow by the alternates of the selected code points (measured on the rebaked assets).
