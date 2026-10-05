---
type: Log Entry
title: 'Raster technique type preservation'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Replaced the proposed `RasterTechnique<any, ...>` erasure with an inferred concrete technique definition and a non-generic common identity constraint. Concrete techniques retain exact options, descriptor, decoded data, resource binding, and glyph-storage relationships; heterogeneous registries expose associated values as `unknown` and must narrow before technique-specific operations. No public helper silently degrades a failed inference to `any`.
