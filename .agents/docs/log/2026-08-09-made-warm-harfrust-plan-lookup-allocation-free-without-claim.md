---
type: Log Entry
title: 'Made warm HarfRust plan lookup allocation-free without claiming a latency win'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Cached shaping plans now compare
borrowed language and feature fields; owned cache keys are created only on a genuine miss. The optimized SIMD Wasm
shrank from 1,131,513 to 1,131,457 raw bytes. The 22,000-glyph localized-edit median remained effectively unchanged
at 9.375 ms versus 9.372 ms, and the strict lane still observed the same later 1,114,112-byte memory claim, so neither
issue is attributed to this lookup.
