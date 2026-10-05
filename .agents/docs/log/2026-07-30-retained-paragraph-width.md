---
type: Log Entry
title: 'Retained paragraph width'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Changed compatible layout-width and viewport-width updates from complete scene/Text replacement to retained `Text.setProperties({ width })`, latest-value queue coalescing, and committed-entry repositioning. The same six-second Paragraph Stress sweep improved from 26.82 to 113.97 RAF FPS, reduced p95 frame time from 43.1 to 9.8 milliseconds, and produced no long tasks in the uninstrumented post-change run.
