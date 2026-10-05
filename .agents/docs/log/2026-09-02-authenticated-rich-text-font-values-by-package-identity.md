---
type: Log Entry
title: 'Authenticated rich-text Font values by package identity'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Structural spans now distinguish live immutable Font and
FontStack values through their private package-owned WeakMap/WeakSet identity rather than a stale public property-name
heuristic. Real Fonts therefore enter the span font slot and never reach authored-style `structuredClone`; Rich Text
retains its font selection after the public `technique` to `raster` rename.
