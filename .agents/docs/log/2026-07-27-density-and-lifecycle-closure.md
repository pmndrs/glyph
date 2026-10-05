---
type: Log Entry
title: 'Density and lifecycle closure'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Published representative 16/32 ppem Bitmap fixtures for every benchmark font, kept 16 CSS px stable across DPR, and made renderer-selected strikes authoritative in telemetry and payload reporting. Comparison surfaces now replace their canvas only after the prior exclusive lifecycle drains, preventing disposed WebGL state from surviving technique switches. MTSDF telemetry reads the committed renderer and raster configuration, Paint & Effects excludes animation-value construction from the timed submit boundary, and comparison teardown drains outstanding GPU queries before renderer disposal.
