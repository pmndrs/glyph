---
type: Log Entry
title: 'Made FontFace transfer explicit and content-addressed'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

D-313 adds `FontFace.clone()` as the only path that copies
font data for another JavaScript realm. Exact selections carry only their raster sidecar and the external resources
that raster actually resolved; aggregate clones carry every loaded authoritative format. The returned
`[SerializedFontFace, transfer]` uses fresh full-span buffers, so transfer detaches the clone without invalidating the
source. A receiving `glyph.fontFace(serialized)` claims those buffers and converges them into its realm-local main,
raster, and resource graph without transferring Fonts, handles, Promises, or renderer resources.
