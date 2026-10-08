---
type: Log Entry
title: 'Removed the last single-root publication fallback'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Internal planners no longer expose a direct `publish()` path,
and their Wasm transport no longer exposes a matching one-root `update()` or owned-copy escape hatch. Every renderer
publication now enters through `glyph.shape()`'s staged engine-wide batch and is consumed as a synchronous borrowed
`CommandBufferView`. The renderer-facing lifetime test now proves lazy command access expires after `decode` returns,
while Rust's focused engine test remains the authority for monotonic renderer-fence acknowledgement. The real 33-cell
Chromium/WebGPU Presentation sweep rendered every workload on first visit with nonzero glyphs and draws, zero slow
frames, Rich Text at 36 draws and 0.49–0.53 ms CPU submit, and Icon Grid at two draws and 0.145–0.19 ms CPU submit.
