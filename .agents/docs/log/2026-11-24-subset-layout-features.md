---
type: Log Entry
title: 'Subset bakes keep every layout feature; --layout-features narrows them'
generated:
  by: process:docs-new
  at: '2026-11-24T19:31:34Z'
---

`glyph bake --unicodes` kept only hb-subset's default-on layout features, so style `features` such as `smcp`, `tnum`
or `ss01` did nothing on a subset font ([issue 02](../planning/issues-0.2.0/02-subset-drops-discretionary-features.md)).
The font baker now keeps every feature by default, matching `hb-subset --layout-features='*'`, and the new
`--layout-features` / `layoutFeatures` option narrows that for full and subset bakes alike
([decision](../planning/decisions/subset-keeps-layout-features.md)). The committed ASCII Inter app assets were rebaked
(2,355,620 to 8,743,692 bytes); the Font Awesome subset is unchanged. `font-baker.wasm` grew 8,415 bytes. Concept:
[`packages/glyph.md`](../packages/glyph.md).
