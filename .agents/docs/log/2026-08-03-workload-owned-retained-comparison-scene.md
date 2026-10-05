---
type: Log Entry
title: 'Workload-owned retained comparison scene'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Moved the remaining 1,573-line multi-technique workload implementation and its 661-line focused test beside the authored workload definitions under `workloads/comparison`. Removed its standalone renderer, RAF, GPU-timer, and telemetry branch. Three Slug performance probes now use an 80-line measurement-owned adapter that creates one `PersistentRenderHost` and activates the same retained scene, completing all 40 fixed-32 browser runs across WebGPU/WebGL2, Inter/CJK, and both candidates. The complete 317-test gate passed; all 42 Presentation cells stayed visible with one renderer, and both timed demos returned to Off-axis / 3D at 59.90/60.02 Icon Grid FPS.
