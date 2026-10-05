---
type: Log Entry
title: 'Exposed the placement snapshot to custom renderers'
generated:
  by: process:docs-new
  at: '2026-10-05T19:23:44Z'
---

`createGlyphPlacements` and its types now publish from `@pmndrs/glyph/core`, and `GlyphPlacements` gained
`caretForOffset` (mirrored on the Three `Text`) so an integration can place a caret for a collapsed selection without
reconstructing cluster boundaries itself. See [the package reference](../packages/glyph.md).
