---
type: Log Entry
title: 'Finished the ordinary Glyph adapter cutover'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

D-301–D-303 place handle-relative loading on the FontFace selection
(`selection.load(handle)` and `selection.isLoaded(handle)`), keep R3F provider/context optional and immutable, and give
hooks deterministic mounted-Font disposal plus Promise-returning eager preload. One material factory now receives both
glyph and decoration contexts while Three retains separate ordered draw/material realizations. The paired
`@pmndrs/glyph-examples` routes prove imperative Three and R3F over shared assets, and the external TypeGPU proof now
enters only through a configured Glyph handle, including recovery onto a second handle with the same immutable Font.
