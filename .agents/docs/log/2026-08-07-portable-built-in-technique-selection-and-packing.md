---
type: Log Entry
title: 'Portable built-in technique selection and packing'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added renderer-neutral Bitmap, MTSDF, and Slug technique implementations. Each retains authenticated CPU resources, explicitly omits absent raster records, returns stable font/resource bindings, and packs positive-down paragraph-local geometry plus technique fields into typed canonical arrays. Bitmap owns per-glyph strike/page selection, MTSDF owns atlas-array selection and effect fields, and Slug retains raw curve/header/reference bytes and analytic addresses without importing Three or applying its texture workaround. The canonical `/raster/bitmap`, `/raster/mtsdf`, and `/raster/slug` paths now select those techniques. The still-merged rendering harness moved to explicit Bitmap/Slug `/v0` paths while the new Three target is built; this is migration scaffolding, not a target-v1 public surface. Package tests cover absent selection, binding identity, range bounds, coordinates, paint, and Slug addresses. A fresh 42-cell Presentation run kept all seven workloads visible for every technique on WebGPU and forced WebGL2 with one renderer per case.
