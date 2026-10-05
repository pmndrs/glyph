---
type: Log Entry
title: 'Performance'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Decode both baker responses in-place while their Wasm allocations are live, copying only artifact ranges that survive release. This removes one full-result copy from the portable and bitmap paths while preserving owned public bytes and unconditional cleanup.
