---
type: Log Entry
title: 'MTSDF package integration'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Promoted the scalar generator from an internal ABI proof into the `@pmndrs/glyph` production build: one Binaryen-optimized Wasm and its Rust-generated JSON contract ship as package resources behind a strict direct-memory TypeScript host. The admission kernel remains zero-import; the full artifact baker adds one contract-declared progress callback for observable Worker bakes. All seven native-msdfgen candidate hashes survive the host; malformed values and outlines, forged and stale allocation ownership, ABI drift, borrowed-result copying, and transactional cleanup are named regressions. Independent size evidence is maintained by the package-size lane. A hash-gated local Node 24 arm64 observation separates compile, initialization, cold-corpus, and warm execution costs; item 8.1 remains open only for the scalar/auto-vectorized/explicit-SIMD shipping decision.
