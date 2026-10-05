---
type: Log Entry
title: 'Published multiple retained paragraphs as one Rust command buffer'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Engine sessions now own an ordered stable-ID
paragraph set rather than one paragraph. Lifecycle upsert/reorder/remove, every child semantic transaction, shared
policy gather, plan serialization, and commit/abort form one atomic publication. Missing semantic spans retain a
child, and per-child geometry retains only referenced regions/exclusions instead of inheriting invalidation from a
sibling's global table prefix. A compiled-Wasm Three-coordinator fixture publishes material groups `[7, 8]`, then
sends only reorder records and publishes `[8, 7]`; all 128 Rust unit tests pass. Optimized Wasm changes from
1,073,248 / 404,463 / 321,189 to 1,082,551 / 407,787 / 324,499 raw/gzip/Brotli bytes. This proves the retained,
renderer-neutral command-buffer delta; public Three GPU realization and end-to-end latency remain open.
