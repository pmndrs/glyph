---
type: Log Entry
title: 'Continued recomposition until the edited line cursor actually converges'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The first retained-line proof required
a whole recomposed line to equal its predecessor, which made convergence after a shifted line boundary impossible.
Rust now recomposes consecutive old bands until cursor, height, and baseline return to the retained ending state, then
reuses the suffix. A three-line regression transfers advance across one boundary and converges at the next. Exact
equal-length ASCII-letter edits also retain structurally invariant Unicode and bidi results; punctuation, spacing,
non-ASCII, and structural edits remain on the complete analysis path. On the unchanged 101-update optimized workload,
median/p95 improve from 5.881/8.406 to 2.607/6.184 ms and RSD falls to 42.4%, with five roughly 1.2 KiB patches.
Optimized Wasm grows 66 raw bytes to 1,147,266. The break-sensitive p95 remains above the 4 ms contract.
