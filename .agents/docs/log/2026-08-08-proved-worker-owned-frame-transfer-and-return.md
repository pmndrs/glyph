---
type: Log Entry
title: 'Proved worker-owned frame transfer and return'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added a test-only, byte-opaque transfer state machine around raw
Wasm publication bytes. One copy enters a bounded capacity-classed worker buffer; transfer to root detaches it and
charges its actual capacity to explicit count/byte backpressure limits. Retirement transfers the same storage back,
where a valid token/capacity pair either re-enters the bounded best-fit pool or becomes unreachable for worker-side
collection. Four focused tests prove exact bytes, two-way detachment, reuse, missing-return backpressure, forged and
duplicate return rejection, failed-send recovery, oversize rejection, and over-limit worker-side discard. The module
does not decode the compiler-defined frame ABI and remains unwired from the shipping TypeScript layout path.
