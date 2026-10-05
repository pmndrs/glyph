---
type: Log Entry
title: 'Bake-host baseline'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Closed roadmap item 7.1 after recording three isolated offline and browser-Worker cold/warm Inter bakes with complete byte parity. Offline cold initialization plus first bake measured a 4.16 ms median and warm same-instance bake 2.94 ms; a fresh Chromium 149 context plus Worker/Wasm first bake measured 21.70 ms and the second job queued on that reused Worker 3.50 ms. Every path returned the exact 172,140-byte canonical artifact. The autoresearch baseline now authenticates this report, but the observations are not portability thresholds; item 7.2 is active.
