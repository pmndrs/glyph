---
type: Log Entry
title: 'Retained ordered UTF-16 edits transactionally inside Rust sessions'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The frame decoder now borrows and validates
replacement records/payloads without allocating mutation objects. Sessions apply sequential edits to retained scratch
and swap only on commit; abort or an invalid later replacement preserves committed text. Compiled Wasm proves cold
reserve/re-pin, retained follow-up edit, invalid rollback, A/B preservation, and no same-capacity memory growth. Styles,
shaping, layout, and nonempty plans remain open, so this adds no end-to-end timing claim. The reachable slice adds
2,829 / 1,528 / 616 raw/gzip/Brotli bytes.
