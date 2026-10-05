---
type: Log Entry
title: 'Added the missing middle-splice workload before choosing edit storage'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The unchanged replacement case remains the
canonical comparison, while a new `localized-splice` case alternates one UTF-16 insertion and deletion in the middle
of the same 22,000-glyph fixture. Ordered-direct measures 9.119 ms median / 10.016 ms p95 and writes 511.3 KiB because
physical records after the insertion move. Stable-indirect proves the intended bandwidth result at 452 B but currently
regresses to 10.776/51.067 ms; equal-length stable replacement is also 2.903/19.312 ms versus ordered-direct's roughly
1.15/5.74 ms. No default changes: stable planning and Three indirection must become correct and fast before chunk-local
UTF-16 storage can be credited with the smaller remaining edit cost.
