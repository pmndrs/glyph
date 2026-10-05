---
type: Log Entry
title: 'Reviewed the final portability size delta'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Relative to the previous accepted snapshot, renderer-neutral `/core`
grows by 10,875 raw / 1,745 gzip / 1,337 Brotli bytes and the complete Three graph by 10,201 / 1,588 / 1,175. The
ordinary tree-shaken browser core changes by only 27 raw / 9 gzip / 47 Brotli bytes. Shaper Wasm grows by 1,668 raw /
774 gzip / 372 Brotli bytes. The reviewed evidence is regenerated at the final source head and passes the size gate.
