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

- **Severity:** ship-blocker (every documented app bake uses `--unicodes`; style `features` silently do nothing on it)
- **Status:** fixed on `experiments/sil-subset`. Justin chose option 1 (2026-11-24: a subset limits characters, not
  features) and asked for a `--layout-features` bake option to narrow it (below).

## What happens

Text styled with `features` such as `smcp`, `onum`, `tnum`, `zero` or `ss01` shapes with the default glyphs when the
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

Option 1. Style `features` accept any tag, so the prepared font must keep every feature the source has; a subset is a
code-point selection, not a feature selection. The cost is the alternates of the selected code points, which is what a
caller of style `features` needs.

## Layout feature selection (Justin, 2026-11-24)

One option, `--layout-features <tags|*>` on the CLI and `layoutFeatures?: readonly string[]` on `bakeFont()`,
`fontIsUpToDate()` and the core `FontBakeSelection`, named after hb-subset's `--layout-features` and mirroring
`--unicodes`/`unicodeRanges`:

- Omitted (or `*`) keeps every feature, with or without `--unicodes`: a full bake keeps the source as it is, and a
  subset of every code point keeps exactly the source's GSUB/GPOS feature tags (Rust test).
- A list keeps those tags plus `skera::DEFAULT_LAYOUT_FEATURES`, hb-subset's default list (`rvrn ccmp liga locl mark
mkmk rlig frac numr dnom calt clig curs kern rclt`, vertical, direction, East Asian spacing and every complex-script
  shaper's features). That set is always kept, so no list can break script shaping; an empty list equals
  `hb-subset` with default features. Glyphs only a dropped feature reaches are not baked and the records are pruned.
  Without `--unicodes`, a list prepares every code point.
- Tags are validated at the boundary (TypeScript and the Wasm selection): four printable ASCII characters,
  space-padded at the end only, at most 1,024, sorted and deduplicated. Malformed tags throw `TypeError` (CLI exit 2);
  tags the source lacks are ignored and listed in `PreparedFontReport.missingLayoutFeatures` and on stderr.
- The selection changes the prepared bytes, and the source fingerprint is taken over them, so the up-to-date check and
  `--check` compare it without a new artifact field; two selections that prepare identical bytes are the same font.
- The runtime (browser worker) bake in `loadFont` does not take the option yet.

## Tests

- Rust (`source_font.rs`): an ASCII subset's GSUB features and glyph counts equal `hb-subset --unicodes=20-7e
--layout-features='*'` (HarfBuzz 14.4.0) for Source Serif 4 (330 glyphs, includes `smcp onum tnum zero`) and Inter
  (484); a subset of every code point keeps the source's features; `--layout-features+=tnum,onum` and default-only
  selections equal hb-subset's (185, 167 and 178 glyphs); missing tags are reported; malformed tags are rejected.
- Node (`node-bake.test.mjs`): on a `--unicodes` bake `smcp`, `pnum`, `onum` and `zero` change the shaped glyphs (the
  `smcp` assertion failed against the previous baker); `--layout-features onum` makes `smcp` a no-op while `onum` and
  the default `liga` still apply, with and without `--unicodes`; `*` equals omitting it; the up-to-date check and
  `--check` see a changed selection; CLI and `bakeFont` reject malformed tags.

## Measured cost

| Committed `--unicodes` asset (Bitmap 32 + MSDF + Slug)    | before      | after                      |
| --------------------------------------------------------- | ----------- | -------------------------- |
| `apps/r3f-hello-world/assets/inter-latin.font.glb`        | 2,355,620 B | 8,743,692 B                |
| `apps/typegpu-hello-world/assets/inter-latin.font.glb`    | 2,355,620 B | 8,743,692 B                |
| `apps/r3f-hello-world/assets/font-awesome-world.font.glb` | 184,508 B   | 184,508 B (byte-identical) |

Each was rebaked with its own `bake:*` script and its `bake:check` passes. `font-baker.wasm`: 1,162,251 B at
`sil-green-67`, 1,161,848 B with the fix alone, 1,170,666 B with the option (+8,415 B, +0.7%).

## Risk

- Behaviour: subset fonts gain alternates; glyph IDs inside a subset may shift (they are renumbered in source order).
  Nothing public exposes subset glyph IDs across bakes.
- API: none.
- Performance/size: subset fonts grow by the alternates of the selected code points (measured on the rebaked assets).
