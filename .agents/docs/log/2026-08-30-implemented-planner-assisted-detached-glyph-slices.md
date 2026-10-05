---
type: Log Entry
title: 'Implemented planner-assisted detached glyph slices'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

A committed `RetainedText` can synchronously emit a complete
checkpoint for selected drawable glyph records without advancing its source publication or acceptance state. Three's
`Text.breakApart()` imports that checkpoint as one independently disposable `Glyphs` group with full local/world affine
matrices, source-aligned transforms, independent materials, original bounds and geometry, and no child-`Text`
reconstruction. Decorations copy through their own checkpoint and object. The benchmark migration now animates those
detached matrices instead of applying mutable placement snapshots to live text; WebGPU and WebGL2 pixel regressions pin
first-frame handoff and same-render upload ordering.
