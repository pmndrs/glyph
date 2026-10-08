---
type: Log Entry
title: 'Removed the redundant homogeneous-policy glyph scan and preserved promoted-range alignment'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The first-party
renderer policy uses one allocation strategy across Bitmap, MTSDF, Slug, and external programs, so Rust now selects
that strategy once before delegating to the planner; mixed policies retain exact per-glyph discovery. Planner
compilation remains the authority that validates program existence and input shape. Dirty-range whole-buffer
promotion now rounds its record end so `end * stride` still satisfies the renderer's byte alignment. All 157 Rust
library tests pass. A short 22k-target run shows no material regression and the optimized shaper is 1,160,505 raw /
442,612 gzip / 348,594 Brotli bytes, +182 / +42 / +233 bytes from the preceding artifact.
