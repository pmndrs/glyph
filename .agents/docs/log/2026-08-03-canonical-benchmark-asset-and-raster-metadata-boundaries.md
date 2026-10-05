---
type: Log Entry
title: 'Canonical benchmark asset and raster metadata boundaries'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Removed renderer-owned font-loader, preload, baked-artifact, and raster-configuration compatibility facades. Live scenes and finite product/conformance targets now call the discriminated `workloads/font-assets` API directly, while Bitmap atlas, MTSDF extension, and Slug allocation inspection live under `benchmark/low-level/raster`. The complete 316-test gate and production build passed; all 19 isolated conformance/product scenarios remained deterministic, all 42 sequential Presentation cells rendered visible pixels with one renderer, and the retained comparison plus exclusive finite-job recovery probe passed on WebGPU and WebGL2. Live renderer chunks fell again to 9.26/3.38 kB minified/gzip for Bitmap, 7.77/2.85 for MTSDF, and 7.28/2.75 for Slug.
