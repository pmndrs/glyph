---
type: Log Entry
title: 'Made transform ownership explicit and removed per-cluster draws'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The first real multi-paragraph publication
exposed that paragraph-local positions had no renderer transform owner and cluster `semantic_id` prevented primitive
coalescing. The policy now requires a paragraph-derived transform draw key, forbids transform from physical storage
identity, and publishes `transformId` in the expanded 64-byte draw record. Compatible clusters coalesce; a span that
crosses semantic IDs publishes zero rather than lying about one cluster. The compiled-Wasm fixture falls from six
draws to exactly two and reverses `(materialId, transformId)` from `[(7,1),(8,2)]` to `[(8,2),(7,1)]` without semantic
resend. Optimized Wasm changes by only +222/+83/+52 raw/gzip/Brotli bytes to
1,082,773 / 407,870 / 324,551.
