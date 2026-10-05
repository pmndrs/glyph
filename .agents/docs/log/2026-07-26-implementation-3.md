---
type: Log Entry
title: 'Implementation'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Closed roadmap item 6.0 on the repository's Three.js 0.185.1, `@types/three` 0.185.1, and TypeScript 7.0.2 pins. Follow-up measurement replaced the provisional exact-signature adapter with direct public `three/tsl` arithmetic calls: clean package and benchmark graph checks complete in 0.18 and 0.17 seconds without casts or a dependency patch, while the method-chain form remains the measured declaration-expansion hazard. The same `WebGPURenderer`/TSL graph produces exact hash `fec0f57de0b19bc7dacb5b0fc3de7b56fc68dfdbeeebc8f9f4c506bf6e821c77` across three measured runs on an asserted WebGPU backend and forced WebGL2 fallback; a deterministic oracle and wrong-pixel negative control also expose and normalize Three.js's 256-byte-aligned WebGPU readback rows. The synthetic shader is not claimed as a rendered font frame; item 6.1 is active.
