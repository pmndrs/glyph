---
type: Log Entry
title: 'Continuous Presentation visibility'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Reproduced the reported sequential black frame after the original settled-frame probe passed: Text Ladder moved its final 1024 px specimen completely beyond the viewport during its cycle hold. The marquee now aligns that specimen's trailing edge inside the viewport, a pure geometry regression covers the complete interpolation, and the package-owned browser probe samples the unobstructed render region throughout every workload interval. Bitmap, MTSDF, and Slug each completed all seven selector-driven workloads with one retained renderer and no blank sample.
