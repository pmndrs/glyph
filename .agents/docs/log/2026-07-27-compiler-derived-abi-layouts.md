---
type: Log Entry
title: 'Compiler-derived ABI layouts'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Closed the ABI portion of item 8.6 without pulling forward selective baking or performance experiments. The font baker, shaper, Bitmap baker, and MTSDF generator/artifact boundary now derive published sizes, alignments, and field offsets from fixed-width `#[repr(C)]` Rust types. Build-only Rust generators emit the portable JSON and exact typed `as const` TypeScript modules from those facts; production hosts import the generated modules, CI rejects stale output, and production Wasm carries no duplicate JSON or ABI-pointer bootstrap.
