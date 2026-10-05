---
type: Log Entry
title: 'Removed benchmark-shell work from active paragraph reflow'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Paragraph Stress now applies its rounded width and
font-size motion inside the retained scene frame hook rather than republishing reactive control state on every step;
unchanged frames stage nothing and live attributes report the actual animated values. Editorial measures each Text
once per reflow, and the isolated performance workflow now includes both active-resize workloads.
