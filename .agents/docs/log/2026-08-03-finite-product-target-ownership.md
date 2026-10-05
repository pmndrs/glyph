---
type: Log Entry
title: 'Finite product target ownership'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Moved the Bitmap, MTSDF, and Slug finite public-`Text` product lifecycles from renderer implementation files into lazy `benchmark/targets/product` modules. Extracted Bitmap line construction, the reusable finite Bitmap scene, exact CPU-reference capture, and renderer-neutral RGBA8 readback into explicit renderer/low-level modules; conformance surfaces consume the neutral capture contract without importing an executable product target. The complete 314-test benchmark gate and production build passed, all 19 isolated headless scenarios remained deterministic, the external raster and retained comparison probes recovered on WebGPU and forced WebGL2, all 42 sequential Presentation cells rendered with one renderer, both timed demos returned to Off-axis / 3D at 60.02 FPS, and React Doctor reported 100/100 with no issues.
