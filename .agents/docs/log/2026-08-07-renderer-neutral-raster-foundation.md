---
type: Log Entry
title: 'Renderer-neutral raster foundation'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Began the local-only target-v1 implementation stack with the exact-typed `RasterTechnique` contract, safe validated constructors for branded technique/resource identities, and type fixtures proving concrete associations survive while heterogeneous data remains `unknown` rather than `any`. The constructor addition records an implementation-discovered gap: the accepted branded input types could not be authored externally without unchecked casts. The erased storage contract became a partial property-key record because a total record rejects finite named-field interfaces; the concrete self-mapped constraint still rejects every non-view field. Split lossless KTX2 page validation and byte decoding from Three texture creation; Bitmap now uses an explicit Three adapter and MTSDF builds its texture array from the same portable bytes. The 42-cell Presentation matrix retained visible output for all seven workloads across Bitmap, MTSDF, Slug, WebGPU, and WebGL2. Milestone 11.2 remains open pending first-party selection/packing and shader/program extraction.
