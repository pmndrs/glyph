---
type: Log Entry
title: 'Pinned cached Promise identity to cache ownership'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

D-304 makes `glyph.init()` return one `Promise<void>` forever
after success, gives the default R3F handle one process-lived operation, and keeps one FontFace load Promise only until
its face/handle record is released. Ready React paths still skip `use()` synchronously. Large byte/resource fulfillment
values require explicit eviction because a reachable fulfilled Promise retains its value.
