---
type: Log Entry
title: 'Separated placement occurrence identity from run geometry revisions'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Placement slots now key on paragraph
incarnation, exact paragraph/boundary-source/ellipsis run source, stable segment/source anchors, numeric block, and
glyph source. A font or local-geometry revision continues to bump the owning run generation without needlessly
retiring every otherwise-stable placement occurrence. The maintained full font-size update drops from 456.5 KiB to
371.3 KiB by removing the approximately 85 KiB per-glyph placement-slot rewrite; its CPU timing change is within noise.
Focused state tests prove geometry-revision retention and distinct boundary-source/ellipsis identities. Three attempted
mixed-bidi micro-optimizations—an extra cluster-row index, deferred segment extension, and source-order row scatter—were
neutral or slower and were removed rather than folded into the checkpoint.
