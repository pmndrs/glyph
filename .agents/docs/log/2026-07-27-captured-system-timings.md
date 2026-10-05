---
type: Log Entry
title: 'Captured system timings'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added benchmark-owned fixed-capacity summaries for synchronous text scheduling, combined public `Text.ready` work, application scene update, total text-update elapsed time, CPU frame submission, and GPU frame time. Captured reports label P50 and P95 explicitly with update, CPU-frame, and GPU-frame sample counts; the shipped `@pmndrs/glyph` library contains no profiling hook, branch, or measurement call.
