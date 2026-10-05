---
type: Log Entry
title: 'Withdrew indexed placement before release'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The placement-slot/session-table ABI, Codec surface, and Three/TypeGPU
realization are removed. Although that candidate preserved batch/draw topology and reduced some write bytes, it added
run/placement reconciliation and renderer indirection while remaining slower than the same-contract baseline. Release
builds now publish the established absolute f32 origins again and compile the numeric-block/segment/run-slot machinery
only for tests and kernel-lab evidence. On the exact 22k ordered Bitmap width-resize harness, the cleanup measures
`3.953 / 3.975 ms` Latin and `3.141 / 3.167 ms` dense CJK versus same-run main medians of `3.801` and `2.985 ms`, while
both still write 170.4/171.7 KiB. The next candidate is one direct engine-owned f32x2 x/y occurrence offset aligned
with existing physical glyph records. Codec authors will not declare slots, tables, bind groups, or backend memory
layout; adapters own that realization and must preserve existing batches, order indirection, primitives, and draws.
