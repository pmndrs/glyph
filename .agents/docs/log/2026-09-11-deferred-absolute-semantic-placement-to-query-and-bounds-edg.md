---
type: Log Entry
title: 'Deferred absolute semantic placement to query and bounds edges'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Positioned semantic rows now retain glyph-local
origin and ink coordinates plus their compact placement-segment index. Width-only placement changes preserve semantic
content revisions and static Codec inputs; public glyph queries and CPU/plan ink bounds compose absolute f32 values
lazily from the authoritative segment translation. Retained line copies rebase segment indices without replaying glyph
arithmetic. The exact package gate passes all 982 tests plus Rust, fuzz, type, and format checks. Two final
20-warmup/101-sample passes over the built artifact pool to `1.562 ms` ordinary Latin, `2.229 ms` justified Latin,
`3.437 ms` mixed bidi, and `2.277 ms` dense CJK median for approximately 22k rendered glyphs. Against the recorded
same-host fresh-main medians (`3.725`, `3.281`, `3.953`, and `2.995 ms`), those are 58.1%, 32.1%, 13.0%, and 24.0%
faster respectively. One justified pass contained obvious host stalls, so only its pooled median—not its contaminated
pooled p95—is used; the independent clean pass measured `2.189 / 2.210 ms` median/p95.
