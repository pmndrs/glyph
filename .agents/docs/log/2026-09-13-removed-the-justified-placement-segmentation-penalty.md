---
type: Log Entry
title: 'Removed the justified placement-segmentation penalty'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Kept the existing exact F16.16 quotient/remainder
distribution and the SIMD flag scan, but stopped forcing every adjusted trivial-order fragment into one placement
segment per cluster. Word-space-only adjustment now reuses the retained stable word/numeric-block segments and ends a
segment immediately after each adjusted space; only nonzero letter-gap distribution selects cluster-granular
segments. A 50-warmup/501-sample A/B/B/A over the 22k justified width-reflow case reduced median time from
`2.067–2.077 ms` to `1.500–1.510 ms` (about 27.3%) with the same one patch and 30.6 KiB write. Ordinary and mixed-bidi
controls remained at `1.538 ms` and `3.321 ms`. The optimized shaper grows by 175 raw / 162 gzip / 34 Brotli bytes.
This rejects a larger aggregate-count line format for now: the measured cost was placement bookkeeping, not division
or the existing second semantic phase.
