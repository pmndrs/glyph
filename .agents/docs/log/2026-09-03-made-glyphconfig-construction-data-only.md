---
type: Log Entry
title: 'Made GlyphConfig construction data-only'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

`defineGlyphConfig()` now returns inert structural data, and
`glyph.handle(name, config)` passes it directly into package-private construction. The public config leaf no longer
leaks an invocation helper or callable factory property, while Vite-style spread/wrapped overrides keep working.
