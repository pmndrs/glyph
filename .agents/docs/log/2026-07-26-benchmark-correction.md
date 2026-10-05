---
type: Log Entry
title: 'Benchmark correction'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Moved the measurement-boundary correction into active item 6.4 after the first bitmap capture exposed the mistake. The app now defaults to Benchmark and exposes a separate Conformance mode with independent technique, WebGPU/WebGL2 backend, and workload controls. Conformance visibly presents reference, candidate, difference, structured results, and validation statistics; its readback, CPU composition, comparison, clipping, and hashing remain test costs. Benchmark mode reports renderer initialization, font fetch/registration, public `Text` readiness, first draw, total startup, artifact/GPU bytes, warm CPU frame submit, FPS, and rolling CPU/FPS histories over a live oracle-free loop. Real WebGPU/WebGL2 timestamp queries remain the item-6.4 follow-up; unsupported GPU timing is visibly unavailable.
