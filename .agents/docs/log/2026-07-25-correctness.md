---
type: Log Entry
title: 'Correctness'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Stopped treating a standalone OpenType `STAT` table as proof of a variable font. Static fonts carrying style attributes now bake normally; actual axis/delta tables remain rejected and named regressions prove both branches.
