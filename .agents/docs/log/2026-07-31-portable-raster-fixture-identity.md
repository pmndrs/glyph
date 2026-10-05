---
type: Log Entry
title: 'Portable raster fixture identity'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Removed the Bitmap fixture's host-specific optimized-Wasm byte count from its portable artifact identity. The integration gate still executes the rebuilt baker and requires every canonical artifact, record, page, and report byte to match; compiled-module hash and size remain host-labeled package-size evidence under reviewed foreign-host ceilings.
