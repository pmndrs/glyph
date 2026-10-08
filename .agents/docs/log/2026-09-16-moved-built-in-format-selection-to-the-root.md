---
type: Log Entry
title: 'Moved built-in format selection to the root'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

`bitmap`, `msdf`, and `slug` now share `@pmndrs/glyph` with `glyph`; their public options and decoded-data types also live there. Renamed `/config` to `/extend` and moved built-in schemas, codecs, and format interpretation helpers there, removing `/raster`. Eight direct consumer bundles retain the same implementation modules and emitted assets as the preceding package and direct implementation imports, with no gzip increase. Core-only imports retain no raster formats. Updated consumers, documentation, and existing package-boundary checks; the 11 focused package tests pass. Baking entry points remain unchanged in this change. See [the package contract](../packages/glyph.md).
