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
- **Status:** fixed on `experiments/sil-subset`. Justin first chose option 1 (keep every feature), then, after
  measuring the cost, the reworked rule below (2026-11-24): every bake keeps the common set, `--layout-features` adds or
  removes, and text that asks for a dropped feature throws instead of silently shaping default glyphs.

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

Final rule ([decision](../decisions/bake-layout-feature-selection.md)):

- **Every bake**, full or `--unicodes`, keeps the common set (`skera::DEFAULT_LAYOUT_FEATURES`, hb-subset's default
  list). A full bake now prepares every code point with that plan, so full and subset bakes agree; it keeps source glyph
  IDs, the glyph count and the legacy `kern` table. This is breaking for full bakes, which kept every feature before.
- **`--layout-features <tokens>`** / `layoutFeatures: string[]`: `*` (first token only) starts from every feature;
  otherwise the base is the common set; `tag`/`+tag` adds, `-tag` removes. Tokens are an order-independent set; a tag
  both added and removed is an error. Accepted by the CLI, `bakeFont()`, `fontIsUpToDate()`, the core
  `FontBakeSelection`, and a runtime-baked `loadFont({ source, runtimeBake, layoutFeatures })` request.
- **Shaping floor**: `ccmp locl rvrn mark mkmk curs rlig rclt`, `ltra ltrm rtla rtlm` and every complex-script
  feature cannot be removed (input error naming the tag). `liga clig calt kern frac numr dnom`, vertical, spacing,
  `jalt`, `rand` are removable.
- **Throw**: the core artifact records the source tags the bake dropped in an optional, version-neutral
  `PMNDRS_font.layoutFeatures: { dropped, family? }` (schema and spec updated; written only when something was dropped).
  Where a style meets its fonts in the render planner (text creation and every update through `resolveTextOptions`,
  which every integration uses), a feature enabled in the paragraph style or a span style that any font it can resolve
  to dropped throws `GlyphInputError` with path `['style', 'features', i]` or
  `['text', 'spans', k, 'style', 'features', i]` and the message
  `feature 'smcp' was not baked into Source Serif 4; bake with --layout-features smcp (layoutFeatures: ['smcp'])`.
  The paragraph style is checked against its font stack and every span font, a span style against its own stack; the
  stack's fonts are all known when the text binds, so no check waits for run resolution. `value: 0` and tags the source
  never had stay silent. Artifacts without the record (older bakes) never throw.
- A face Skera 0.5.1 cannot prepare (Noto Sans CJK's whole BMP overflows its GSUB serializer) is baked as it is when
  the bake named neither `--unicodes` nor `--layout-features`: every feature kept, nothing recorded, and a
  `LAYOUT_FEATURES_KEPT` warning in the report and on stderr. With either option it fails.
- Freshness: the up-to-date check compares the prepared bytes' fingerprint and the recorded dropped list; `--check`
  compares bytes.
- A full runtime bake keeps the original source for later runtime rasters; the loader rebuilds the prepared bytes from
  it (`*` plus `-tag` per dropped tag) the first time a runtime raster needs them.

## Tests

- Rust (`layout_features.rs`, `source_font.rs`, `tests/public_api.rs`): grammar (order independence, `*` position,
  contradiction, floor, malformed tags); ASCII features and glyph counts equal `hb-subset --unicodes=20-7e` (HarfBuzz
  14.4.0) for the default (Source Serif 167 glyphs, Inter 178), `+=smcp,onum` (224), `-=liga` (158), `'*'` (330/484)
  and `'*' -=ss01,ss02`; a full bake keeps source glyph IDs and count and the same features as a subset of every mapped
  code point; the default drops `smcp c2sc onum tnum zero ss01` and reports them; floor features survive; the artifact
  records `{ dropped, family }` only when something was dropped.
- Node (`tests/integration/layout-features.test.mjs`): full and ASCII default bakes refuse `smcp` with the exact
  `GlyphInputError`, stay silent for `value: 0` and for `swsh` (absent from the source), keep `liga`; full and subset
  bakes record the same dropped list; `smcp,+onum` shapes small caps and old-style figures and refuses `pnum`; `*`
  keeps everything and `*,-ss01,-ss02` refuses `ss02`; `-liga` breaks the `fi` ligature and refuses explicit `liga`; a
  span style and an update are refused and the update leaves the text unchanged; an artifact without the record never
  throws; the runtime raster source is rebuilt byte-for-byte from the original and the dropped list; freshness and
  `--check` see a selection change that only changes the dropped list; CLI syntax errors exit 2, a floor removal exits
  1 naming the feature. `runtime-bake.test.mjs`: the Worker matches the Node bake for `*,-ss01`, and a runtime
  `loadFont` request forwards and validates its tokens.

## Measured cost

| Committed `--unicodes` app asset (Bitmap 32 + MSDF + Slug) | `sil-green-67` | every feature (first fix) | final (common set) |
| ---------------------------------------------------------- | -------------- | ------------------------- | ------------------ |
| `apps/r3f-hello-world/assets/inter-latin.font.glb`         | 2,355,620 B    | 8,743,692 B               | 2,355,908 B        |
| `apps/typegpu-hello-world/assets/inter-latin.font.glb`     | 2,355,620 B    | 8,743,692 B               | 2,355,908 B        |
| `apps/r3f-hello-world/assets/font-awesome-world.font.glb`  | 184,508 B      | 184,508 B                 | 184,508 B          |

The final Inter asset is 288 bytes larger than before the issue: the `layoutFeatures` record. Each was rebaked with its
own `bake:*` script and its `bake:check` passes. The full-bake benchmark fixtures shrink where their fonts carry
discretionary alternates (Source Serif 4 -28%, Amiri -10%, DotGothic16 -7%, Inter -1.5%; all 32 files 150.5 MB to
139.6 MB) and are unchanged where they do not (the CJK and Devanagari showcase subsets, Font Awesome). The Noto Sans
CJK conformance font, a full bake Skera cannot prepare, is byte-identical (kept as it is).

## Risk

- Behaviour: full bakes lose discretionary features unless asked for, and text that enabled one now throws. Every
  committed fixture was rebaked; source fingerprints of every bake now name the prepared bytes.
- Format: one optional, version-neutral field; older readers ignore it, older artifacts never throw.
- API: one new option (CLI, `bakeFont`, `fontIsUpToDate`, `FontBakeSelection`, runtime `loadFont` request); new
  report fields `preparation.missingLayoutFeatures` / `droppedLayoutFeatures`; `preparation` is now always present.
