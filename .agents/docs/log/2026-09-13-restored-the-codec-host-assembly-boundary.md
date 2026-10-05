---
type: Log Entry
title: 'Restored the Codec host-assembly boundary'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Three now reaches the host-only system-buffer attachment helper through
the existing `config/raster` assembly module rather than importing a package-internal contract directly. This changes
no Codec bytes or runtime behavior and closes the top cleanup PR's restricted-import lint failure.
