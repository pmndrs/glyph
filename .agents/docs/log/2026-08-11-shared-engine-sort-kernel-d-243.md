---
type: Log Entry
title: 'Shared engine sort kernel (D-243)'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Twelve per-type engine sort call sites now lower their ordering keys into
`u64` images and run through one retained `(key, index)` pair instantiation plus one raw-key instantiation, with the
wide style-cascade key as two stable passes and permutations applied by cycle walking. Equal-key order becomes total
and deterministic. The optimized shaper drops 50,579 raw / 14,458 gzip bytes to 1,109,644 / 428,350 / 337,447 with all
tests, bake goldens, and benchmark lanes unchanged; the remaining 45.5 KiB of sort bodies are HarfRust-internal.
