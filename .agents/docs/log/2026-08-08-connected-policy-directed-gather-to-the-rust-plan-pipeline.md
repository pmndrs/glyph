---
type: Log Entry
title: 'Connected policy-directed gather to the Rust plan pipeline'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

One reusable workspace now resolves every program's
semantic/glyph/strike/resource recipe into 16-byte-aligned four-record F32/U32 lanes and feeds the plan compiler. A
Rust proof emits a nonempty ordered plan with exact packed bytes across all source scopes and unchanged warm capacity.
Compiled Wasm reserves its policy-independent 32,768-entry plan-glyph arena at initialization (1,245,184→3,342,336
bytes) and one declared F32 lane at policy registration (→3,538,944); both repeated operations are growth-free. The
production frame reaches the gather with empty layout input, so nonempty timing remains open. Optimized size changes
838,060 / 312,606 / 246,732→845,580 / 315,285 / 249,221 raw/gzip/Brotli bytes.
