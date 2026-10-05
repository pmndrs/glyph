---
type: Log Entry
title: 'Collapsed the planned FontFace cache surfaces into Glyph'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

D-298 records that Three's base `Loader` supplies no
cache or dependency discovery, Three's URL-only `FileLoader` cache is not used by Glyph's current loader, and current R3F
adds a separate `useLoader`/`suspend-react` cache. The FontFace path instead makes `handle.load()` enter the sole Glyph
resource graph; Three may observe work through `LoadingManager`, while React only suspends on the same stable promise.
The selected format is resolved solely through the authenticated core GLB raster directory, and an external raster plus
every resource required by its decoder must finish before the selection becomes loaded. Missing formats throw without
filename guessing or GLB runtime baking. Generated sidecar patterns remain producer conveniences: a sidecar cannot
independently assert technique support or serve as a FontFace root.
