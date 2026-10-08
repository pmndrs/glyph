---
type: Log Entry
title: 'Retained icon scaling'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Split each virtual icon tile into independent icon and fixed-size label `Text` generations. Interactive size changes now rebuild only the visible one-glyph icon batches and incrementally resize the existing overscanned pool, rather than reshaping every unchanged label and replacing the complete scene for each slider value.
