---
type: Log Entry
title: 'Completed the capability-shaped policy ABI'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Extended the compiler-mapped registration transaction with exact
capability-set, program-planning, and physical-buffer metadata: backend limits and upload costs, capability-specific
program selection, technique/resource and batch-key masks, ordered-direct versus stable-indirect allocation, and
aligned padded strides. Unknown capabilities and unsupported combinations fail before revision change; the executor
proves padding-safe writes. V0 keeps independently bindable vector streams and uses policy bytecode to pack `vec2`/
`vec4` records instead of adding aliased mutable interleaving. The focused Rust and Node gates pass; the optimized SIMD
artifact measures 739,647 raw / 272,532 gzip / 214,186 Brotli bytes. Retained diff compilation remains the next proof.
