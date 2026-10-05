---
type: Log Entry
title: 'Worker lifecycle'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Replaced implicit concurrent posts with one explicit FIFO bake, job-local queued cancellation, active-cancellation Worker replacement, and entry-side serialization. Two authenticated live Chromium observations show that sharing one initialized Worker within a three-font burst also beats three sequential Worker initializations, while a multi-Worker pool remains evidence-gated.
