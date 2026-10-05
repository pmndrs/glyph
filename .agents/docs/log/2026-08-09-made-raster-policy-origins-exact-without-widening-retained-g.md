---
type: Log Entry
title: 'Made raster policy origins exact without widening retained glyph storage'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The first-party policy had treated
positioned ink-box starts as baseline origins, then subtracted the baked raster plane a second time. The mapping was
dormant while the legacy TypeScript renderer remained authoritative and became visible only after the single-path
Rust cutover. The independent Bitmap CPU oracle exposed a 12 px vertical displacement and 33,492 differing channel
bytes; no tolerance or fixture changed. Rust now exposes explicit origin policy fields and maps each renderable glyph
to its existing semantic-glyph record with one `u32` index. The already-retained cluster-ID lane supplies plan semantic
identity, so the hot render glyph record does not grow. The public WebGL2 Bitmap target passes 32/32 exact frames with
zero differing bytes and pinned SHA-256 `a47930d3…15e893`; the complete paragraph matrix passes 32/32. The 22k direct
benchmark returns to the pre-fix 107.56 MiB retained high-water mark. Optimized Wasm is 1,159,121 raw / 441,811 gzip /
347,554 Brotli bytes, 818 / 451 / 415 bytes above the prior checkpoint.
