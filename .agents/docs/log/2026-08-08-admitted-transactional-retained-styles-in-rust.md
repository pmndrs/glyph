---
type: Log Entry
title: 'Admitted transactional retained styles in Rust'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

`text_update` now decodes canonical style snapshots and
removals without allocation, merge-compacts them by stable ID into pre-reserved flat A/B session arenas, and validates
authored cascade order, nesting, UTF-16 ranges, language/features, registered stacks, root completeness, numeric
domains, and request aliasing before commit. A real-font compiled-Wasm transaction commits text plus its root style,
rejects root removal without revision advance, and preserves `memory.buffer` after session creation. The module is
888,423 / 332,740 / 262,748 raw/gzip/Brotli bytes (+31,592 / +13,737 / +10,512). Payload admission is linear and
retained validation uses one reusable-scratch O(n log n) sort. Layout does not consume styles yet,
so no frame-latency claim is attached.
