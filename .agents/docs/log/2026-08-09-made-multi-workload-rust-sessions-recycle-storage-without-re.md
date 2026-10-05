---
type: Log Entry
title: 'Made multi-workload Rust sessions recycle storage without recycling semantics'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Frame admission now covers removal
plus insertion records rather than only final paragraph count. A recycled paragraph clears every semantic arena and
identity marker while retaining its allocations, and one session prewarms one reusable paragraph instead of applying a
4,096-glyph batch capacity to every child. This removes the invalid-request and allocation failures across the
text-ladder, zoom, and 476-paragraph icon-grid transitions. Rust capacity identity, public Three double replacement,
all 201 package tests, all 131 Rust tests, and a complete 27-cell Bitmap/MTSDF/Slug WebGPU transition sweep pass. The
optimized shaper is 1,090,859 raw / 411,106 gzip / 325,149 Brotli bytes.
