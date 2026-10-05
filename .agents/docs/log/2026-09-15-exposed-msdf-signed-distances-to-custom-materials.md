---
type: Log Entry
title: 'Exposed MSDF signed distances to custom materials'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

D-365 publishes `fillDistance`, `trueDistance`, and
`pixelRange` through both Three shader paths and raw TypeGPU detailed output. WebGPU and WebGL2 verify channel/sign
semantics, scale and rotation, exact fill reconstruction, and a glow outside coverage. A substituted coverage field
fails the numeric oracle. The shared TypeGPU reconstruction retains the existing coverage API.
Refreshed the three affected JavaScript renderer size entries; their gzip deltas are +68 bytes for direct TypeGPU,
+22 bytes for Three, and +68 bytes for Three plus TypeGPU. Unrelated Wasm evidence remains pinned to `main`, and all
existing size ceilings remain unchanged.
