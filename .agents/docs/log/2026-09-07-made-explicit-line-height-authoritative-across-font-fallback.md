---
type: Log Entry
title: 'Made explicit line height authoritative across font fallback'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Line extents now use the stack primary's metrics,
accept negative half-leading for tight authored values, and reuse resolved extents across repeated cluster styles. A
compiled primary-versus-fallback regression and public Inter-to-Amiri measurement both hold `lineHeight: 0.92` at 0.92
em; the live 11,510-glyph Paragraph Stress update-and-measure path measured 1.94 ms p95.
