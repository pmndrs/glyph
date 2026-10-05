---
type: Log Entry
title: 'MTSDF direct-memory ABI'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Split host mechanics from geometry: `mtsdf-core` remains allocator-agnostic `no_std + alloc`, while `mtsdf-baker` owns `dlmalloc`, a Rust-generated JSON contract, and a checked C ABI over exact active allocations and borrowed RGBA8 results. The zero-import direct-memory integration test proves contract access, generation identity, release, and stale-pointer rejection. The complete Binaryen-optimized boundary is 44,368 bytes (17,930 gzip; 14,865 Brotli).
