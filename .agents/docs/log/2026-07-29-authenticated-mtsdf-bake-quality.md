---
type: Log Entry
title: 'Authenticated MTSDF bake quality'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Exposed integer `emSize` and full `pixelRange` controls without changing the 64/8 recommendation or its established raster key. Omitted or partial options resolve against 64/8; explicit effective 64/8 canonicalizes to the legacy fieldless descriptor, while non-default identities carry both effective values. The artifact fixes `planeUnitsPerEm` to `emSize` and uses `ceil(pixelRange / 2)` padding so odd ranges remain contained. Real 155-glyph subset bakes at 32/4 and 32/6 pass semantic validation, proving the configurable path while leaving comparative quality and payload benchmarking open. The existing low-level Wasm ABI is unchanged. The added host options measure 15,430 minified / 4,701 gzip / 4,176 Brotli bytes, and the full baker Wasm measures 534,709 raw bytes; the reviewed host ceiling now includes that authenticated configuration surface.
