---
type: Log Entry
title: 'Reduced the completed fragment-reflow stack without changing its topology'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Classified the final stack against
D-355 before editing, then removed the dormant run-handle allocator, completed shadow planners, duplicate visual-span
ledger, placement-handle mirror, and pass-through placement wrappers. Shared retained-flow and gather authorities now
replace repeated lookups and synthetic normalization paths. Instrumented Rust coverage stayed exactly unchanged while
six overlapping tests were removed; built-package Node coverage slightly increased while 241 overlapping cases were
consolidated, cutting that measured lane from `91.17 s` to `34.65 s`. The cleanup layer is net `−3,984` lines against
PR #175 and preserves the same batches, primitives, draws, stable identities, placement rows, and renderer-submission contract.
Exact-head 22k width-reflow medians are `1.483 ms` ordinary Latin, `2.097 ms` justified Latin, `3.360 ms` mixed bidi,
and `2.328 ms` dense CJK, with `30.6/30.6/35.1/96.3 KiB` writes. The shaper falls by 7,132 raw / 2,929 gzip / 2,213
Brotli bytes relative to #175. Three is 8,652 raw / 8,426 minified / 2,196 gzip / 1,815 Brotli bytes smaller;
Three+TypeGPU is 8,609 / 8,431 / 2,120 / 1,601 bytes smaller. Direct TypeGPU remains −5 raw / −5 minified /
+4 gzip / +29 Brotli bytes.
