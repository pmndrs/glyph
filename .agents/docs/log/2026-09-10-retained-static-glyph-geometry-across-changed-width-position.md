---
type: Log Entry
title: 'Retained static glyph geometry across changed-width positioning'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Geometry-only reflow now authenticates and
reuses committed glyph-local, raster, and effect rows for visually trivial, boundary-free, undecorated text. The single
positioning traversal recomputes compact segment translations and absolute CPU query coordinates, refreshes dynamic
clip/region/thread/transform metadata, and rejects any stable-id, glyph, font, or outline-membership mismatch. Two
31-sample ordered Bitmap repeats pool to `3.237 / 3.377 ms` median/p95 for 21,805 Latin glyphs and `2.493 / 2.583 ms`
for 21,978 dense-CJK glyphs, versus exact-main medians of `3.769` and `3.091 ms`. Every sample preserves one draw and
the existing 174,440/175,824-byte f32x2 direct-offset patch, so the measured 14.1%/19.4% median gains come from reduced
CPU positioning work rather than a GPU-layout or publication-byte change. The final compact offset publication and
browser/size gates remain open.
