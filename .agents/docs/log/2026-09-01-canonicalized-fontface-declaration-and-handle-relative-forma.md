---
type: Log Entry
title: 'Canonicalized FontFace declaration and handle-relative formats'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The accepted call shape is now
`glyph.fontFace(source, { family?, format? })` over one source, with generated `Font{id++}` families and a handle-configured
default format. Built-in `ThreeConfig` chooses MSDF, while a spread/wrapped config may select another registered key.
A single format or the first member of a format array is the default and aliases the FontFace object itself; string keys
resolve through a handle's typed technique map, while imported techniques and requests such as
`bitmap({ strikes: [8, 16] })` carry exact associated types and bake options. `handle.load()` and `handle.isLoaded()` own
runtime resolution, known selections receive exact style capabilities, and family strings receive the handle-wide style
union plus runtime validation. One GLB directory owns embedded/external raster discovery; no child source list remains.
