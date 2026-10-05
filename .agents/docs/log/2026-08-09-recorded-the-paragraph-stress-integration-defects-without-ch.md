---
type: Log Entry
title: 'Recorded the Paragraph Stress integration defects without changing shaping invalidation'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Origin lookup indexing is
now lazy and Bitmap strike replacement initializes every required input stream. The observed 11,510-glyph MTSDF probe
moved `plan.apply` from about 1.02 ms to 0.14 ms and total retained update from about 6.89 ms to 4.63 ms, with differing
sample histories explicitly preventing a universal speedup claim. Focused public Three fixtures cover both defects.
