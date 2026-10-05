---
type: Log Entry
title: 'Policy interpreter tail measurement'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Driving the kernel-lab explicit artifact at controlled record counts:
a 4-record vector iteration costs ~50–75 ns and each scalar tail record ~50 ns, so a span of 7 records
(1 vector + 3 scalar, 282 ns) costs more than the 8-record two-vector shape (181 ns) that a tail-overlap
rewrite would produce. Overlap would therefore save roughly 100 ns per tailed draw-span — real but bounded:
a frame needs thousands of tailed spans before it reaches microseconds. Not wired per the D-245 admission
bar; revisit if a workload profile ever shows many small draw-spans dominating the packing pass.
