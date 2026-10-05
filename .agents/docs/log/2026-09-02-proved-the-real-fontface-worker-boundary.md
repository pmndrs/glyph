---
type: Log Entry
title: 'Proved the real FontFace Worker boundary'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added an actual `worker_threads` transfer through the public FontFace
declaration API. Posting the clone detaches every transferred buffer in the sender; the receiving realm reconstructs
and loads the exact Bitmap selection with `fetch` disabled, preserves selection Promise identity, and leaves Glyph's
shaping engine uninitialized in both realms. D-313's remaining executable proof is complete.
