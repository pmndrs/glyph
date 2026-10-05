---
type: Log Entry
title: 'Collapsed redundant positioning specializations'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Replaced the fragment-wide compile-time justification and
text-effect booleans with build-invariant runtime branches, leaving one positioning traversal and the same shared
cluster/glyph emission authority. The two former constants were threaded through most of the positioning call graph
even though they guarded only the small adjustment tail and optional effect-lane append. This removes 80 Rust source
lines and 26,486 raw / 3,200 gzip optimized-Wasm bytes. A 20-warmup/101-sample A/B/B/A over 22k ordinary, justified,
bidi, and dense-CJK width updates preserves exact patch counts and bytes; ordinary, bidi, and CJK medians are within
0.3%, while a longer 50-warmup/501-sample justified A/B/B/A measures the runtime form only 0.34% slower, within host
variation and still materially faster than main. The predictable branches are retained because duplicating the full
positioning machine code did not buy a measurable end-to-end advantage.
