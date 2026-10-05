---
type: Log Entry
title: 'Decoration rendering (D-248)'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Underline, overline, and line-through render end-to-end from baked font
metrics: public span `decoration` styles, decorating-box cascade stamping, continuous merged lines across nested
spans, CSS paint order via record placement, resource-free decoration draws through both planners, and one shared
Three flat-quad material. Solid lines only; other styles are rejected at the boundary. A same-window interleaved
A/B against the pre-decoration checkpoint shows the undecorated fast path within noise. Closing the slice
surfaced and fixed two defects the conformance lane caught: decorated sessions entered the retained gather path
before falling back, stacking each update's rows onto the previous buffers, and the decoration shader fed
sRGB-encoded paint to the linear working space, rendering mid-tone lines lighter than their glyphs. The rich-text
probe now counts underline and line-through instances per case and pins them with the composed evidence.
