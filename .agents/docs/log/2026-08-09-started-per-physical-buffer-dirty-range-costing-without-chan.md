---
type: Log Entry
title: 'Started per-physical-buffer dirty-range costing without changing publication'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added a stride-specific Rust
coalescer with exact tests for divergent narrow/wide gap decisions, fragmentation and 75% full-live promotion, zero
stride, and overflow. Existing ordered/stable callers remain on the compatibility wrapper until the next atomic
checkpoint, so no upload or frame-time gain is claimed.
