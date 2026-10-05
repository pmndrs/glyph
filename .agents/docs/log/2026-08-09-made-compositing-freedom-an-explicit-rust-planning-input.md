---
type: Log Entry
title: 'Made compositing freedom an explicit Rust planning input'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

`TextGroup` and R3F now expose the same `ordered` or
`independent` construction policy. Ordered remains the prose-safe default; independent permits the Rust ordered-direct
and stable-indirect planners to coalesce compatible interleaved resources. Icon Grid selects independent mode. The
optimized shaper is 1,101,079 raw / 417,984 gzip / 328,164 Brotli bytes.
