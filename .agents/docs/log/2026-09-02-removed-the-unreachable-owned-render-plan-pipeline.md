---
type: Log Entry
title: 'Removed the unreachable owned render-plan pipeline'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Configured handles now retain only the synchronous borrowed
publication path used by `glyph.shape()`, Three, R3F, and the example renderer. The deleted alternative copied every
Wasm publication, eagerly built a second payload manifest, awaited a renderer Promise, validated the returned buffer,
and pooled exact-size allocations, but no GlyphConfig integration referenced it and the engine-wide shape batch
explicitly rejected it. D-318 records one zero-copy rendering path while keeping explicit FontFace Worker transfer
independent and lazy.
