---
type: Log Entry
title: 'Internalized Codec system-buffer layout below raster authoring'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

A portable `RasterCodec.codecBody` now receives
only the frozen renderer capability set and authors glyph-local technique buffers. After authenticating that body, the
engine appends stable-glyph identity, optional transform identity, and the direct f32x2 placement offset through a
package-private host step. Codec authors can neither declare nor collide with those buffers, and adapter-specific
interleaving, attributes, or storage remain below the portable contract. Focused package and integration tests inspect
the compiled operation tail and prove that host stores remain present. This is an ownership/API correction, not a
performance claim; the current width path still publishes one offset per rendered glyph.
