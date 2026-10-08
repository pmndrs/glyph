---
type: Log Entry
title: 'Committed Text invalidation identity'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Paint-only updates now mutate generation state without replacing the wrapper keyed by font-disposal listeners. A regression proves font disposal still removes painted batches and that semantic no-ops preserve terminal invalidation rather than scheduling a doomed retry.
