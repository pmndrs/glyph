---
type: Log Entry
title: 'Staged compact LayoutRun placement below existing batching'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Normal core execution now retains fixed numeric
blocks, stable word-root placement segments, separate visual spans, one segment index per rendered glyph, and exactly
one f64 inline/block translation per segment beside the still-authoritative absolute output. The single existing
positioning traversal populates both; justification state is not duplicated into placement rows. Retained lines copy
and rebind compact metadata by canonical run revision and stable segment anchor, with a capacity-reused revision index
preventing per-segment run scans. Boundary source and ellipsis own distinct replacement runs and blocks. No segment,
role, or placement field enters Codec batch keys or draw topology, and no ABI, renderer, or performance claim exists
until the atomic f32x2 publication cutover removes absolute glyph writes.
