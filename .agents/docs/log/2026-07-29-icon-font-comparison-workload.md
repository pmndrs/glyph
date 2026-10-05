---
type: Log Entry
title: 'Icon-font comparison workload'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added the licensed 1,402-glyph Font Awesome Free Solid 6.7.2 catalog to Bitmap, MTSDF, and Slug. The live workload presents a 38-by-37 two-axis plane with fixed centered labels, logarithmic 8–1,024 CSS-pixel icon scaling, viewport-relative three-row/column overscan, and transactional `Text` recycling. The product probe traverses both axes to the final icon and back with zero missing glyphs while retaining 143 pooled entries at its standard viewport.
