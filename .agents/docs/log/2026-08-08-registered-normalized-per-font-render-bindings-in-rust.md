---
type: Log Entry
title: 'Registered normalized per-font render bindings in Rust'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added a cold compiler-mapped ABI for one font-owned
technique/program variant, field-major glyph/strike/resource lanes, scalable or ordered physical strikes, dense
strike×glyph resource selection, and exact shaping-coverage validation. Rust hostile-wire and strike-selection tests
pass; compiled Wasm registers a binding against real baked Inter, proves owned/idempotent state and conflict, retains
it through the stack lifecycle, and removes it with final font disposal. The optimized module changes from 829,906 /
309,646 / 244,790 to 838,060 / 312,606 / 246,732 raw/gzip/Brotli bytes. Policy gather and frame timing remain open.
