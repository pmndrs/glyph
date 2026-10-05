---
type: Log Entry
title: 'MTSDF direct browser gate refreshed'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The current WebGPU base-level scenario produces framebuffer hash `4da56d…`, 14,400 changed pixels, 2,420 colors, and a 6,798,412-byte compressed artifact. Forced WebGL2 produces `8cbb665b…b912`; both independent scalar comparisons stay below `0.0186` mean absolute error with maximum error `1` and zero threshold error pixels. The renderer output passed; the failing scenario gate was stale mip-era evidence that still expected the removed path's wording, compressed size, and WebGL2 pixels, so the assertion now follows the authenticated base-level artifact rather than misattributing the mismatch to rendering.
