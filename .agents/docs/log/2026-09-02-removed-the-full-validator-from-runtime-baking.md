---
type: Log Entry
title: 'Removed the full validator from runtime baking'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The runtime OTF/TTF Worker now trusts the core and raster GLBs
produced by Glyph's own bakers, reading only the GLB envelope, reserved extension identity, compatible versions, and
ranges required to pass core metadata into raster baking and composition. Node `/bake` explicitly supplies the full
schema/Khronos validator at the same two pipeline checkpoints, so authoring and CI validation are unchanged. A size
graph boundary now rejects `validator`, AJV, or `gltf-validator` in the Worker's initial graph. The Worker fell from
784,513 to 50,412 raw bytes and from 146,042 to 10,437 gzip; the independent validator leaf remains unchanged. The
post-change 33-cell Chromium/WebGPU sweep again rendered every workload on first visit with nonzero glyphs and draws,
zero slow frames, Rich Text at 36 draws and 0.475–0.53 ms CPU submit, and Icon Grid at two draws and 0.125–0.155 ms.
