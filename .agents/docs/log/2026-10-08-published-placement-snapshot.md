---
type: Log Entry
title: 'Published the placement snapshot to custom renderers'
generated:
  by: process:docs-new
  at: '2026-10-08T20:12:55Z'
---

Published `createGlyphPlacements()` and its placement types from `@pmndrs/glyph/core`, and mirrored
`caretForOffset()` on Three `Text`, so custom UI renderers can replace private-module patches with the supported
integration surface. The UTF-16 lookup follows logical cluster ownership while retaining visual bidi edges, keeps hard
line-break gaps on the preceding line, starts soft-wrap boundaries on the following line, and pins interior surrogate
or combining offsets to their owning cluster. Real Inter and Amiri tests cover RTL, mixed direction, LF, CRLF, trailing
newlines, wrapping, emoji, combining marks, invalid offsets, and the public entry boundary. This preserves the intent of
[David von Wrangel's community contribution #223](https://github.com/pmndrs/glyph/pull/223) while addressing its
correctness review. See the [package reference](../packages/glyph.md) and [uikit integration](../planning/uikit-integration.md).
