---
type: Log Entry
title: 'Corrected the MTSDF reference and isolated remaining generator differences'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The reference serializer inserted
zero-length closing edges and omitted CFF contour reversal. After correcting those inputs, Inter `8` reconstructs
identically in Glyph and native Simple coloring at 63 error samples; native Distance and InkTrap each reach 20.
Isolated stage comparisons identify coarse winding classification and skipped protected-texel inversion corrections
as separate causes of smaller Source Serif/Dancing Script differences. The change retains the reference fixes,
regression tests, reproduction script, and findings; temporary stage tooling is omitted. This supersedes the native
counts and hypotheses in the initial investigation below.
