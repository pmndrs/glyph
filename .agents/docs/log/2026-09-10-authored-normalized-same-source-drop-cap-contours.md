---
type: Log Entry
title: 'Authored normalized same-source drop-cap contours'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

`DropCapLayout.contour` now accepts a validated simple polygon
in normalized coordinates over the existing generated cap exclusion box. The generated ABI retains the contour beside
the cap controls; Rust validates, fingerprints, stages, and projects it conservatively into each body-line band while
preserving the existing source selection, placement, alignment, side, and margin semantics. Focused evidence covers
exact frame-wire serialization, tapered line cuts, a mixed Slug-cap/Bitmap-body retained edit, all 330 Rust library
tests, all 54 Three integration tests, and the strict public type project. Editorial now authors the contour; the
refreshed Bitmap/MTSDF/Slug × WebGPU/WebGL2 matrix passes through both native TSL and experimental Three/TypeGPU while
retaining three draws across every 64-sample reflow sequence.
