---
type: Log Entry
title: 'Deferred attached glyph deformation outside the cleanup stack'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Removed the complete attached Three
`Text.transformGlyphs()` implementation, its matrix sidecar, material/storage invalidation, transformed measurement
composition, and focused tests from the final fragment-reflow cleanup PR. The generic synchronous
`Text.withGlyphs<Result>()` read still returns its callback value, and detached `Glyphs` transforms remain unchanged.
D-357 preserves D-356 as an accepted cross-adapter follow-up design while correcting its implementation status;
shipping it now requires separately scoped Three and TypeGPU lifecycle, storage, interaction-geometry, and performance
evidence.
