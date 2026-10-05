---
type: Log Entry
title: 'Restored MTSDF paragraph orientation'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The canonical TypeGPU MTSDF vertex stage now converts the engine's downward paragraph Y into Three's upward Y, matching Bitmap, Slug, decoration, and the previous native TSL realization. A numeric regression pins the asymmetric origin and quad offset so a whole-paragraph mirror cannot pass unnoticed.
