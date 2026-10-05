---
type: Log Entry
title: 'Made transform batching policy-selectable and executed indexed Bitmap draws'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Corrected the temporary global
transform draw boundary. Programs may now split on transform and consume nonzero draw-level IDs, or omit that key and
pack stable region transform slots into first-party policy buffer 15. The Bitmap Three executor applies Rust buffer
patches, binds direct resources, keeps matrices in a renderer-owned sidecar, and updates scene transforms without a
Wasm call. Visible overflow no longer invents a clip boundary. Rust tests prove split and indexed modes; compiled Wasm
retains two material draws and collapses the same two paragraphs to one six-instance draw after their material IDs
converge, with exact slots `[2,2,2,1,1,1]`. All 129 Rust tests and the focused Three integration pass. Optimized Wasm
is 1,083,255 raw / 411,409 gzip / 324,539 Brotli bytes. Browser pixels, MSDF/Slug, and public Three cutover remain open.
