---
type: Log Entry
title: 'Removed product HarfBuzz subprocesses'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

`glyph glyphs`, `glyph bake --unicodes`, and programmatic
`@pmndrs/glyph/bake` now use the packaged Fontations/Skera baker Wasm. One normalized prepared source feeds core
shaping and every requested raster technique; HarfBuzz remains internal test-oracle tooling only.
