---
type: Log Entry
title: 'Persistent renderer API cleanup'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Removed the unused standalone Bitmap, MTSDF, and Slug preview constructors and 676 lines of duplicate renderer, RAF, GPU-timer, telemetry, resize, and disposal lifecycle. The remaining contracts are named for persistent scenes, and a boundary regression rejects reintroducing preview entrypoints. The complete 315-test benchmark gate and production build passed; live renderer chunks fell from 16.82/5.19 to 10.37/3.84 kB minified/gzip for Bitmap, 9.02/3.32 to 8.37/3.12 for MTSDF, and 9.26/3.37 to 8.19/3.09 for Slug. All 42 sequential Presentation cells rendered visible pixels with one renderer, and both timed demos completed their authored sequence, returned to Off-axis / 3D, and measured 59.92/60.02 Icon Grid FPS on WebGPU/WebGL2.
