---
type: Log Entry
title: 'Every bake keeps the common layout features; --layout-features adds or removes'
generated:
  by: process:docs-new
  at: '2026-11-24T19:31:34Z'
---

`glyph bake --unicodes` silently dropped discretionary OpenType features, so style `features` such as `smcp`, `tnum`
or `ss01` did nothing on a subset font ([issue 02](../planning/issues-0.2.0/02-subset-drops-discretionary-features.md)).
Every bake, full or subset, now keeps the common set (hb-subset's default list); `--layout-features` / `layoutFeatures`
adds (`tag`), removes (`-tag`) or starts from every feature (`*`), and cannot remove the shaping floor. The core artifact
records the dropped tags in an optional `PMNDRS_font.layoutFeatures`, and text that enables one throws
`GlyphInputError` where its style meets the font ([decision](../planning/decisions/bake-layout-feature-selection.md)).
Every committed bake fixture and app asset was rebaked with its own script. Concept:
[`packages/glyph.md`](../packages/glyph.md); format: [`PMNDRS_font`](../planning/extensions/PMNDRS_font/README.md).
