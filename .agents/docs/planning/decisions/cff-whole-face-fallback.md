---
type: Decision
title: 'CFF subsetting requires explicit whole-face fallback'
description: 'A CFF or CFF2 Unicode subset fails early unless the caller explicitly accepts retaining the complete source container.'
decision_status: Proposed
decided: '2026-10-17'
generated:
  by: process:docs-new
  at: '2026-10-17T20:49:24Z'
---

# CFF subsetting requires explicit whole-face fallback

## Decision

When a selected face has CFF or CFF2 outlines and the caller requests Unicode subsetting, the baker fails before
publishing an artifact. The caller can opt in to a whole-face fallback through `allowWholeFaceFallback` or the direct
CLI's `--allow-whole-face-fallback`; portable runtime loads carry the same option through their Worker and cache key.
The fallback keeps the original source bytes and selected face index, reports
`whole-face-fallback` and the retained byte count, and does not claim that the requested Unicode set removed glyphs.
TrueType outlines continue through Skera subsetting.

## Why

Skera 0.5.1 does not subset CFF/CFF2 outlines. Its default flags omit those tables, so the old preparation path
reported success and a later raster bake misleadingly reported missing outlines ([issue #180](https://github.com/pmndrs/glyph/issues/180)).
Passing the original CFF table through a subset is unsafe because Skera renumbers the other glyph-indexed tables.
Automatic retention can make a one-code-point request retain a multi-megabyte font. D-239 keeps HarfBuzz executable
subsetting out of the product pipeline, so the explicit fallback preserves that constraint.

## Consequences

The prepared-font report identifies whether preparation actually subset the face. For a collection, the fallback retains
the whole original container so the selected face's offsets and glyph IDs remain intact; its byte count includes the
other collection faces. Direct-bake freshness compares the effective selected face, and the CLI prints retained source
and output sizes both when baking and when reusing a fresh artifact; JSON reports the same for a bake.
This corrects the implicit assumption in D-239 that every supported outline format can be Unicode-subset with Skera.
Compact CFF/CFF2 artifacts still require a future upstream subsetter or an explicitly prepared external input font.
The supported direct-memory pairing is this package's TypeScript wrapper with its matching font-baker Wasm and generated
ABI. `createFontBaker` accepts caller-supplied modules for that contract; it does not promise that an older V0 module
whose preparation report lacks these fields will run with a newer wrapper.
