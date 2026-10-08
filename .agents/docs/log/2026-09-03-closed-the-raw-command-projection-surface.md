---
type: Log Entry
title: 'Closed the raw command-projection surface'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

GlyphConfig integrations now receive only the renderer-bound
`CommandBufferView` through `GlyphRenderer.decode`. The borrowed Rust publication, typed command tree, projector, and
publication transaction moved behind the package boundary; the public closed `GlyphInstanceKind` union retains the
semantic display-list vocabulary without exposing numeric wire identities or a second decoder API.
