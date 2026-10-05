---
type: Log Entry
title: 'Retained bidi and shaping-run itemization moved inside `text_update`'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

UAX #9 output now fills reusable
active/pending level, class, paragraph, and equal-level-run arrays. Root direction changes paragraph base level;
nested direction carries a distinct override bit and forces parity during one style×script×level interval sweep.
The sweep skips mandatory hard-break controls and commits/aborts with the session. Rust tests and host/SIMD Clippy
pass. Optimized Wasm is 968,086 / 362,664 / 286,438 raw/gzip/Brotli bytes (+4,067 / +1,899 / -2,304). Fallback
shaping, layout, nonempty plan output, and complete-path timing remain open.
