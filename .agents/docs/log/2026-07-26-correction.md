---
type: Log Entry
title: 'Correction'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Made bitmap density explicit in the live and captured rendering contracts: a 16 px strike renders at 16 device pixels, so 2× DPR uses an 8 CSS px layout rather than silently magnifying the atlas. The selected strike now travels with the draw batch; metrics report baked ppem, rendered ppem, CSS size, and scale ratio. The live canvas fills the available runner area, stays transparent over the design-token grid, and leaves the header and captured-result row content-sized. Replaced placeholder copy with the five-lane benchmark ipsum covering Latin rhythm, numerals, kerning, punctuation, ligatures, and common mathematics; Inter coverage and the 120 visible-glyph draw are executable gates.
