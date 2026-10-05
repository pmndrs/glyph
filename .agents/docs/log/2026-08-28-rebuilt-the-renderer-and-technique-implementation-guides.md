---
type: Log Entry
title: 'Rebuilt the renderer and technique implementation guides'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The durable guides now show every callable lifecycle
step, current text mutation and measurement, resource leasing and realization, transactional acceptance, canvas/device
topology, worker transfer, shader subpaths, portable geometry, policy assembly, raster decoding, and baking. Public
`layout()` and `glyphs()` TSDoc concisely names possible cache-miss lookup costs, and their canonical constraint caches
are bounded to three LRU answers so arbitrary resize probes cannot retain glyph arrays forever.
