---
type: Log Entry
title: "Removed the example renderer's parallel font/publication recipe"
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The custom TypeGPU renderer now declares its
exact `glyphExample` RasterFormat and default in `GlyphConfig.fonts`, accepts a loaded `glyph.fontFace()` selection at
`handle.createText()`, and lets Text acquire and release its own immutable Font lease. Its acceptance path no longer
calls low-level `loadFont()`, and the implementer guide no longer invents `text.publish()`; `glyph.shape()` remains the
sole semantic batch boundary. The exported config factory keeps one nameable `GlyphConfigFor` annotation required by
`--isolatedDeclarations`, while the DSL callbacks, handle, roots, bindings, and format selection infer without casts.
