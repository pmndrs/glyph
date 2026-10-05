---
type: Log Entry
title: 'Added synchronous demand-read glyph inspection'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Core, Three, and TypeGPU Text controllers now expose
`withGlyphs(callback)` for indexed glyph reads without publishing or copying the complete semantic layout.
A fixed private Wasm descriptor plus fixed per-record scratch keeps setup independent of glyph count; callback lifetime,
thenable rejection, and a shared engine reentry gate prevent borrowed views from surviving or mutating their source.
