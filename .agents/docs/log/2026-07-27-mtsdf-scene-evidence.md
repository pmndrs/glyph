---
type: Log Entry
title: 'MTSDF scene evidence'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Refreshed the finite WebGL2 four-scene golden after the earlier geometric fill/outline correction intentionally changed effected pixels. The CI-style Chromium renderer produces `57e86b4b…a1e7`; GPU-friendly Chromium has a separate deterministic adapter result. Validation still gates resize, mip, transform, effects, glyph/draw counts, changed pixels, colors, and payload bytes.
