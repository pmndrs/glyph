---
type: Log Entry
title: 'Retained Bitmap layout buffers'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added transactional raster batch staging so real font-size changes still reshape and re-layout while compatible Bitmap generations retain geometry, UVs, textures, materials, colors, and draw objects. Same-strike updates independently upload changed origin and size attributes; incompatible glyph/page topology retains the established rebuild fallback. The package-owned Paragraph Stress rendered-size profile improved from 5.14 to 19.39 RAF FPS, isolating the remaining cost to paragraph work and the existing 560-draw topology rather than GPU execution.
