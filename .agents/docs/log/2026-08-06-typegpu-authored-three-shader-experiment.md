---
type: Log Entry
title: 'TypeGPU-authored Three shader experiment'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Recorded `@typegpu/three` `toTSL()` as a real shader-authoring bridge rather than treating TypeGPU and TSL as necessarily independent implementations. The optional path can share TypeGPU-authored raster evaluation with raw WebGPU and Wayfare while the Three adapter continues to own nodes/accessors, materials, pipeline state, rendering, and lifecycle. It remains an experiment behind an explicit export subpath until the pinned Three.js proof inspects generated shaders, establishes Bitmap/Slug render parity, and measures tree-shaken transfer, graph-build, and shader-compilation cost.
