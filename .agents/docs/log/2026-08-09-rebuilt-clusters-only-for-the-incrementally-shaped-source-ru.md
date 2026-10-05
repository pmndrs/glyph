---
type: Log Entry
title: 'Rebuilt clusters only for the incrementally shaped source run'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Exact grapheme/glyph topology now permits the
cluster builder to retain all other SoA lanes and rebuild the changed run's advances, bindings, glyph adjacency,
safe/break flags, and identities. The affected window includes its predecessor break because that decision depends on
the changed run's first safe-concatenation flag; any mismatch falls back cold. A field-for-field cold oracle covers
every retained lane. On 101 optimized updates, median/p95 improve from 6.894/9.314 to 5.881/8.406 ms with the same
five roughly 1.2 KiB patches. Optimized Wasm grows 7,633 raw bytes to 1,147,200; the p95 contract remains unmet.
