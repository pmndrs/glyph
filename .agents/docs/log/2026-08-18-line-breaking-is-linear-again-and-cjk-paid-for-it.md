---
type: Log Entry
title: 'Line breaking is linear again, and CJK paid for it'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

`BreakState::class_after_spaces` scanned
`source` from index 0 on every call, and LB16/LB17 consult it on every `CL`/`CP`/`B2`. Latin prose reaches
those rules rarely; CJK reaches them on most characters, so the whole analysis was O(n^2) on exactly the
scripts the repository treats as first-class. `numeric_prefix_before` carried the same shape in reverse for
LB25. Both are now `partition_point` over an array that is built in one forward pass and therefore already
sorted, which makes the rewrite provably equivalent rather than empirically equal. All 19,338 official
Unicode 17 line-break vectors and both bidi conformance suites are unchanged, positions and required flags
alike. Measured through the shipped Wasm at 22,000 glyphs over an interleaved three-round A/B: the CJK
corpus improves 1.58x cold, 1.69x suffix-edit, 1.85x localized-edit, and 1.61x localized-splice, while the
Latin corpus holds flat within noise (a first-pass +9.6% on `measure-query` did not survive 20 warmup /
101 measured, landing at -1.0%). The artifact grows 121 raw / 81 gzip bytes. The regression hid because
every layout benchmark ran Latin only; `glyph:rust-layout-benchmark` now takes `--corpus latin|cjk` against
the pinned CJK showcase strike, so the lane that would have caught this exists.
