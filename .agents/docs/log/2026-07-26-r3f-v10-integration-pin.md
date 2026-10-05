---
type: Log Entry
title: 'R3F v10 integration pin'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Replaced the provisional React Three Fiber 9.6.1 lane with the agreed 10.0.0-alpha.2 release and switched repository imports to its `/webgpu` subpath. Its published peers already accept React 19.2 and Three.js 0.185.1, but the WebGPU entry eagerly imports Three's browser-only Inspector and therefore fails during Node module evaluation. A narrow patch stops auto-extending that optional Inspector; a second patch retargets the 9.1.0 test renderer's static Three/R3F imports to the WebGPU entry. Upstream should make Inspector registration lazy and publish a v10-aware WebGPU test-renderer entry. The deterministic Node harness supplies and restores only the animation globals required by `frameloop: 'never'`; browser compatibility remains owned by the real `WebGPURenderer` root and Suspense probes.
