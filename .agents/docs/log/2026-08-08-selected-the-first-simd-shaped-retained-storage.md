---
type: Log Entry
title: 'Selected the first SIMD-shaped retained storage'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added a test-only direct-pointer kernel lab over real 25,515-
and 100,602-glyph paragraph arrays and three isolated Wasm builds. Node 24 and Chromium 149 reproduce exact scalar
hashes for horizontal, vertical, partial-tail, and four-byte-aligned inputs with no warm allocation path or memory
growth. Compiler-vectorized source beats hand-written record packing; explicit 16-lane break/bidi masks and
integer-exact summaries pass the 20% admission threshold; large-workload evidence selects ABI-private 64-cluster,
16-byte-aligned SoA chunks. The selected lab delta is 1,652 raw / 1,158 Brotli bytes, while the standard production
SIMD artifact is 289 raw / 26 Brotli bytes smaller than scalar. SIMD now builds by default without runtime dispatch;
`PMNDRS_GLYPH_SHAPER_SIMD=0` produces the same-ABI scalar artifact, whose disassembly contains no vector instructions
and whose 34 focused semantic tests pass. Policy execution, boundary search, native SIMD, and end-to-end contribution
stay measured follow-ups rather than inferred wins.
