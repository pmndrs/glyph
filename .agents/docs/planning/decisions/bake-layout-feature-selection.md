---
type: Decision
title: 'Every bake keeps the common layout features; --layout-features adds or removes'
description: 'A bake, with or without --unicodes, keeps the common OpenType layout features unless --layout-features adds or removes some; the shaping floor cannot be removed, and text that enables a dropped feature throws where it meets the font.'
decision_status: Accepted
decided: '2026-11-24'
generated:
  by: process:docs-new
  at: '2026-11-24T19:31:35Z'
---

# Every bake keeps the common layout features; --layout-features adds or removes

## Decision

- **Default, for every bake.** A bake keeps the common set, `skera::DEFAULT_LAYOUT_FEATURES` (hb-subset's default
  list: what shaping applies unasked, `frac numr dnom`, the vertical and direction features, and every complex-script
  shaper's features), whether or not it names `--unicodes`. A full bake prepares every code point with the same plan,
  so a full bake and a subset bake keep the same features for the same code points. A full bake keeps the source's glyph
  IDs and glyph count, and its legacy `kern` table.
- **Grammar.** `--layout-features <tokens>` (`layoutFeatures: string[]` in `bakeFont()`, `fontIsUpToDate()`, the core
  `FontBakeSelection`, and a runtime-baked `loadFont` request), comma-separated:
  - `*` starts from every feature the source has; it must be the first token;
  - otherwise the bake starts from the common set;
  - `tag` or `+tag` adds a four-character OpenType tag; `-tag` removes one.
  - The tokens are a set: apart from `*`, order does not matter, repeats are ignored, and a tag both added and removed
    is an error. Examples: `smcp,onum`, `*`, `*,-ss01,-ss02`, `-liga`.
- **Shaping floor.** `-tag` cannot remove `ccmp locl rvrn mark mkmk curs rlig rclt`, the direction features
  `ltra ltrm rtla rtlm`, or any Arabic, Hangul, Indic, Tibetan, Khmer, Myanmar or Universal Shaping Engine feature
  (`init medi fina isol med2 fin2 fin3 cswh mset stch ljmo vjmo tjmo nukt akhn rphf rkrf pref blwf half abvf pstf cfar
vatu cjct pres abvs blws psts haln dist abvm blwm`). Trying is an input error that names the feature. `liga`, `clig`,
  `calt`, `kern`, `frac`/`numr`/`dnom`, the vertical and East Asian spacing features, `jalt` and `rand` are removable.
- **Refusal.** The core artifact records the source tags the bake dropped (`PMNDRS_font.layoutFeatures.dropped`, with
  the family name). Text whose style or span style enables a dropped tag throws `GlyphInputError` where the style meets
  its fonts (text creation or update), naming the tag, the font and the flag to add. Every font a style can resolve to
  is checked: the paragraph style against the paragraph's font stack and every span font, a span style against its own
  font stack. A tag the source never had stays silent, as in CSS and HarfBuzz; `value: 0` never throws; an artifact
  without the record throws nothing.

## Why

Justin, 2026-11-24: a subset limits characters, not features, and full and subset bakes must agree. Keeping every
feature by default made the ASCII Inter app asset 3.7x larger for alternates most text never asks for, so the default
is the set HarfBuzz-model shapers apply unasked plus what scripts need, and discretionary features are opt-in. Silent
fallback to default glyphs is the failure issue 02 reported, so a request for a dropped feature is the caller's error,
reported at the call that made it ([engine call contract](../../../skills/engine-call-contract/SKILL.md)).

The floor is what a shaper needs to produce correct text rather than typographic preference. HarfBuzz applies
`ccmp locl rvrn mark mkmk curs rlig rclt` and the direction features for every script, and the complex shapers apply
their script's features to form required conjuncts, joining forms and jamo; removing any of them yields wrong text for
some script. `liga`, `clig`, `calt` and `kern` are on by default but are preference in the scripts that use them
(Latin, Greek, Cyrillic), and `frac`/`numr`/`dnom` only serve fraction formatting. Glyph lays out horizontally, so the
vertical features are removable.

Evidence: [issue 02](../issues-0.2.0/02-subset-drops-discretionary-features.md). Rust tests compare feature sets and
glyph counts with HarfBuzz 14.4.0's `hb-subset` for the default, `+=`, `-=` and `'*'` forms.

## Consequences

- Breaking: a full bake drops discretionary features (`smcp c2sc onum lnum tnum pnum zero ssXX cvXX salt swsh dlig
hlig sups subs case ...`) unless asked for, and every committed bake fixture and app asset was rebaked. Text that
  enabled one of them now throws instead of silently using default glyphs.
- Every bake prepares its source, so the source fingerprint names the prepared bytes. A full runtime bake keeps the
  original source for later rasters and rebuilds the prepared bytes from it (`*` plus `-tag` for each dropped tag) the
  first time a runtime raster needs them.
- The up-to-date check compares the prepared bytes' fingerprint and the recorded dropped list.
- Skera 0.5.1 cannot serialize the GSUB of some very large faces (Noto Sans CJK's whole BMP). A bake that named
  neither `--unicodes` nor `--layout-features` then keeps the source as it is, every feature and glyph, records nothing
  dropped and reports the `LAYOUT_FEATURES_KEPT` warning; a bake that asked for either fails with `SUBSETTING_FAILED`.
- Supersedes this file's earlier proposal (`subset-keeps-layout-features`: keep every feature; a list adds to the
  common set).
- Open: no drop-only form beyond `-tag`; a font registered twice with the same shaping payload keeps the first
  artifact's dropped list.
