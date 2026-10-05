---
type: Log Entry
title: 'Collapsed borrowed publication bytes to one arena per root'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Engine committed/pending stages and renderer
candidate transactions remain atomic, but the Wasm result transport no longer alternates two buffers whose bytes
already expire before the next call. Publication, query, detached-copy, and failure results now share one reusable
arena; the unused `outputSlot` header field is removed. Rejection still retains renderer-owned accepted state and
forces the next engine result to be a checkpoint. The default reservation falls by one result arena per root.
