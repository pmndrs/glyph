---
type: Log Entry
title: 'Implementation'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Closed roadmap item 6.1 with the first real bitmap font frame and explicit density control. The canonical 927,148-byte Inter GLB travels through registry loading, HarfRust layout, strict R8 KTX2/record decode, 695,296-byte texture upload, one order-preserving instanced batch, and one shared TSL graph. The existing app buttons now select real 1×/2× renderer density while automated runs declare it. WebGPU and forced WebGL2 agree on exact half-coverage ink geometry at both densities after their opposite readback row origins are normalized; framebuffer bytes scale from 122,880 to 491,520 and total tracked GPU bytes from 818,176 to 1,186,816. Transactional decode releases earlier textures on any later failure, and external page residency remains deferred to Milestone 13. Item 6.2 is active.
