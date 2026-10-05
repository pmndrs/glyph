---
type: Log Entry
title: 'Skipped retained raster reconstruction for position-only changes'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Retained gather now proves that the active
Codec outputs depend only on semantic position fields before updating those fields and CPU ink bounds in place. That
path does not repeat font binding selection, raster resource lookup, or full `PlanGlyph` construction; any glyph,
strike, resource, u32, topology, or non-position dependency falls back to the established gather authority. On the
22k ordered Bitmap adoption-only benchmark, paired on/off runs improved from `4.603` to `4.467 ms` and from `3.866`
to `3.827 ms` (about 1–3%). This is a bounded CPU-publication improvement: the complete width path still publishes
one f32x2 direct offset per glyph, so the 170.4 KiB write and the compact-segment milestone remain open.
