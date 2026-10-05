---
type: Log Entry
title: 'Refreshed retained contracts for outward measurement rounding'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Re-derived the two public paragraph fixtures after
D-359 changed measurement publication to round outward. The only new values are the UIKit content height and the
unconstrained Japanese CJK width; glyph topology and placement arrays are unchanged. The UIKit generator now checks
its retained public exact-height result directly instead of reconstructing a pre-D-359 value from content height.
