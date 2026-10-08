---
type: Log Entry
title: 'Preserved Labs workload identity in performance reports'
generated:
  by: process:docs-new
  at: '2026-10-08T13:31:39Z'
---

A local #240 comparison exposed ambiguous labels in the Markdown report: sorted Labs rows sharing a truncated name
prefix were restored using candidate registration order, assigning some timings to another schedule's name. The parser
now preserves ambiguous printed labels. Read-publication workloads put scene count and schedule first, making their
printed prefixes unique. A distinguishing reordered-prefix regression passes alongside 16 existing workflow tests; Labs
types and focused lint pass. Raw Labs samples remain intact. The local run reproduced large per-object read costs, but
substantial clock drift prevents treating small changes as conclusive; the full CI suite remains the formal gate.
