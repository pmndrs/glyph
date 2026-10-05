---
type: Log Entry
title: 'Deleted the redundant Three paragraph-target transaction'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The Rust command buffer is now the sole render-state
transition authority. Removed the candidate/current `ThreeBitmapTarget`, `ThreeMtsdfTarget`, `ThreeSlugTarget`, retained
revision, and old renderer-program registry; the executor keeps only GPU resource/draw/material tables, synchronization,
and reversible presentation overrides. First-party technique imports no longer register targets as side effects. Migrated
the composition proof to ordinary Bitmap policy packing plus `defineTextMaterial`, so customization changes canonical
shader output without owning layout, attributes, geometry, or another transaction. This deletes 1,496 source lines. The
measured technique runtime graphs shrink only 45 raw bytes each (19–20 gzip bytes for Bitmap/MTSDF and 20 for Slug),
proving the deleted targets were already outside those consumer graphs rather than attributing an invented payload win.
