---
type: Log Entry
title: 'GPU timing'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Closed the remaining item-6.4 implementation gap with Three.js's public timestamp-query path: the live `WebGPURenderer` requests adapter timestamps on WebGPU and disjoint timer queries in forced WebGL2, resolves at the reporting cadence on the next animation callback, and stores genuine GPU milliseconds in the existing fixed typed-array ring. Query teardown is transactional: a closing preview stops publishing and scheduling, allows the one active query to drain, then stops and disposes the renderer. The causal Vitexec surface now proves WebGPU → WebGL2 → WebGPU replacement with a real timing sample from every supported backend and no timer cushions, device loss, or console errors.
