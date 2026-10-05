---
type: Log Entry
title: 'Opaque canvas presentation'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Moved the design-token background and optional 16 CSS px grid into every live renderer as an opaque screen-space pass. The grid remains fixed across text transforms, pan, scale, and DPR, and grid-off skips the mesh instead of revealing a CSS layer. Increased the retained MTSDF hard-shadow offset so Paint & Effects exposes a legible displaced shadow against the in-canvas surface.
