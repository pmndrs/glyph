---
type: Log Entry
title: 'Performance'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Removed quadratic paragraph-layout scans with one-time cluster prefix indexes, a monotonic style cursor, and direction-aware binary bounds over HarfRust's monotone clusters. An 80,000-glyph justified-layout stress pass dropped from a 431 ms to 268 ms median in the same five-sample local Node run; the browser core cost is 1,140 minified / 240 Brotli bytes.
