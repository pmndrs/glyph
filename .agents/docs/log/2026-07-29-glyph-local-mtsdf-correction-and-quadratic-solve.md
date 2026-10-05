---
type: Log Entry
title: 'Glyph-local MTSDF correction and quadratic solve'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Retained the upstream-compatible edge-fast correction before a bounded alpha-confirmed residual pass, both inside each glyph's tight padded rectangle. Replaced nine-start Newton approximation for quadratic distances with the pinned reference's exact stationary-point solve. Native-oracle coverage remains zero-error across seven cases; the admission square's corrected deterministic FNV-1a identity is `bfc76761`. The Font Awesome two-icon pass falls from about 392 to 170 milliseconds and its complete nine-page bake from 212.3 to 109.9 seconds on this host. Remaining scallops on complex overlapping icons at extreme magnification also reproduce in pinned native `msdfgen` at the same 64-pixel field resolution, so correction is not mislabeled as analytic-scale fidelity.
