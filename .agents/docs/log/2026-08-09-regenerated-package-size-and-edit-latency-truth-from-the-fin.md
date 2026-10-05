---
type: Log Entry
title: 'Regenerated package-size and edit-latency truth from the final stable-addressing artifact'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The renderer-neutral
core is 1,257,322 raw / 460,673 gzip / 364,097 Brotli bytes, including the 1,159,121 raw / 441,811 gzip /
347,554 Brotli shaper Wasm. The complete Three adapter plus engine is 1,505,897 / 500,509 / 396,903 bytes; Three,
React, and React Three Fiber remain external peers. A sequential eight-warmup/31-sample 22k Bitmap run measures the
ordered-direct equal-length edit at 1.330/6.328 ms and middle splice at 8.369/8.473 ms median/p95. Stable-indirect
middle splice measures 10.683/11.149 ms and writes only 452 B. The earlier 51.067 ms stable figure was the maximum of
an 11-sample run (the benchmark's percentile index selects the maximum at that sample count), did not reproduce, and
is not retained as ordinary latency evidence. A stricter stable equal-length run detected late Wasm growth before it
could publish a report, so stable-indirect remains a correctness capability rather than the first-party default.
