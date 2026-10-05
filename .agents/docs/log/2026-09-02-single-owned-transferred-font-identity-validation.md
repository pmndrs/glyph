---
type: Log Entry
title: 'Single-owned transferred-font identity validation'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Reduced the eager `SerializedFontFace` claim to a canonical
safe transport envelope and non-aliasing ownership transfer. The lazy importer remains the sole semantic authority:
it checks declared identities against authoritative GLB and dependency bytes before admitting missing graph nodes.
Focused loader, FontFace, and fuzz tests pass, including proof that an unsafe buffer shape fails synchronously while a
forged identity reaches and fails the lazy importer. This second reduction removes another 1,941 raw / 315 gzip bytes
from Core and 1,941 raw / 299 gzip bytes from Three. The live 33-cell WebGPU sweep again rendered every workload with
nonzero glyphs and draws and zero frames over 20 ms.
