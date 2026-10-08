---
type: Log Entry
title: 'Made physical render-plan patches dependency-directed'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Positioning now records exact six-F32/four-U32 change
bits in a compact side lane while preserving the 60-byte `PlanGlyph`. Policy validation propagates those bits through
the straight-line program once and records each output buffer's semantic dependencies. Ordered-direct and
stable-indirect compilers execute and publish only intersecting buffers; new, rebound, and conservatively described
records still rewrite every output. On 21,805 real raster instances, a full-column resize now writes 170.4 KiB for
Bitmap and 340.7 KiB for MTSDF or Slug instead of 1,022.1/2,384.9/2,384.9 KiB cold-plan payloads. Font-size writes
340.7/340.7/681.4 KiB respectively. Five-warmup/11-sample latency remains above the gate at
4.599/4.916/6.057 ms for Bitmap/MTSDF/Slug resize; the reduction does not support a packing-dominance claim and makes
layout the next measured optimization target. The optimized module is 1,065,394 / 399,111 / 317,830 raw/gzip/Brotli
bytes.
