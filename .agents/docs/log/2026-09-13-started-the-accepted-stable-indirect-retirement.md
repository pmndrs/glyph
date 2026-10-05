---
type: Log Entry
title: 'Started the accepted stable-indirect retirement'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Removed the unused stable planner, slot pool, chunked order arena,
mixed dispatcher, public Three allocation option, Codec strategy field, render-plan order-buffer fields, and renderer
order lookup. Ordered planning remains the sole physical-storage path. Stable glyph identity, placement generations,
paragraph rank, batching keys, primitive spans, and draw order remain intact. Final benchmark, compressed-size,
renderer, and independent Opus verification are still pending.
