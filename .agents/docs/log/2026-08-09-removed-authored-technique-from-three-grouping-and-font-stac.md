---
type: Log Entry
title: 'Removed authored technique from Three grouping and font stacks'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

`createFontStack` now accepts heterogeneous
Bitmap/MSDF/Slug fonts from one runtime and preserves their technique union, while the legacy single-technique
`ParagraphBatch` rejects that union at its own boundary. `TextGroup` and its R3F wrapper no longer accept or expose a
technique. A compiled-Wasm public lifecycle fixture proves one Bitmap-root paragraph with an MSDF span is partitioned
by the Rust policy/plan into two draws and resolves one custom material factory under both technique contexts.
