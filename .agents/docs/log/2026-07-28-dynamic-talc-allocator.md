---
type: Log Entry
title: 'Dynamic Talc allocator'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Replaced ABI-private `dlmalloc` with pinned `talc` 5.0.4 in the portable font baker, Bitmap baker, MTSDF baker, and HarfRust shaper. The same optimized four-module corpus saves 46,610 raw, 15,121 gzip, and 12,121 Brotli bytes while retaining artifact, ownership, cancellation, reused-Worker, and malformed-input coverage. A representative 128 MiB global arena saved no meaningful transfer bytes and raised initial Wasm memory to about 129 MiB, so global arena allocation is rejected; a request-local scratch arena remains profiling-led future work with an explicit lifetime proof.
