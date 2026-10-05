---
type: Log Entry
title: 'Centered and simplified the R3F hello-world scene'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The public `Text` component now infers a runtime-selected
Bitmap/MSDF/Slug font-stack union without `Text<AnyRasterTechnique>`. The example removes its probe-only effect, ref,
frame callback, canvas attributes, redundant button-row group, and unnecessary independent-compositing declarations.
`Text` and `TextGroup` now construct through R3F host commits, so three React `Activity` branches pre-render complete
hidden technique layers instead of initializing them after the first click. Vitexec reads named R3F layers directly,
proves all six hidden planned meshes exist before switching, and verifies 2 draws / 11 visible records per revealed
technique. The controls form a centered top row and the world copy remains centered in the viewport. The benchmark's
exact React reconciliation target retains hash `bb15bbcc`, natural/narrow layout oracles, object identity, span paints,
and submitted draws; its explicit teardown releases the live paragraph before its target-owned font because R3F host
disposal runs at idle priority. The example's root `bake` and `bake:check` scripts now compose separate Inter and icon
commands, keeping each multi-technique GLB independently regenerable and verifiable. Two independent current bakes
reproduced each asset exactly. The icon migration changes only generator/source-provenance metadata; every binary view
is unchanged. Inter's extents and Bitmap/MSDF/Slug views are unchanged, while the package-owned subsetter serializes
same-length `GPOS`/`GSUB` tables differently; a full Basic Latin plus ligature/kerning stress pass produced identical
glyphs, clusters, positions, advances, lines, and measurements through both artifacts.
