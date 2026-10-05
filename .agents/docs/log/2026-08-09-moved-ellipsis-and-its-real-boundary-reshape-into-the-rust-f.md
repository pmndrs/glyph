---
type: Log Entry
title: 'Moved ellipsis and its real boundary reshape into the Rust frame transaction'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Only truncated flow threads build a
retained boundary arena; ordinary reflow retains zero boundary reshapes. Font-stack ellipsis selection, complete
no-wrap overflow, narrowed final-tail context, spacing, stable glyph identity, positioning, semantic inspection, and
render-plan publication now share the one Rust update. A public Amiri/Three regression proves the result differs from
incorrect whole-run reuse and matches the narrowed shaping oracle. All 136 Rust library tests and 204 package tests
pass. Same-machine detached-baseline comparison finds column-resize medians within 0.15 ms and mixed cold results, so
the checkpoint is recorded as performance-adjacent rather than assigned a speedup. Its aggregate optimized Wasm delta,
including adjacent renderer-integration fixes, is +13,639 raw / +5,797 gzip / +5,579 Brotli bytes.
