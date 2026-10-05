---
type: Log Entry
title: 'CI evidence closure'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Regenerated the package-size report and its authenticated autoresearch index after the observable Worker-bake work changed the measured host graph. The runtime-baker host now measures 11,437 raw / 9,524 minified / 3,819 gzip / 3,428 Brotli bytes; its reviewed ceiling moves by at most 100 bytes per representation while the Bitmap and MTSDF runtime ceilings remain unchanged.
