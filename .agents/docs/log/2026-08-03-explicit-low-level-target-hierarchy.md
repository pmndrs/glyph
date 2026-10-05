---
type: Log Entry
title: 'Explicit low-level target hierarchy'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Moved the external raster and React reconciliation product proofs under `benchmark/targets/product`; moved the realtime MTSDF/Slug comparison, runtime fallback, and their target tests under `benchmark/targets/conformance/raster`; and placed shared CPU raster/source-outline oracles under `benchmark/low-level/raster`. Conformance surfaces retain literal lazy target imports, while a boundary regression rejects renderer imports of executable targets. The complete 311-test benchmark gate and production build passed, all 19 isolated headless scenarios remained deterministic, and the moved realtime comparison and external raster proof recovered on both WebGPU and forced WebGL2.
