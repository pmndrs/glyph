---
type: Log Entry
title: 'Icon-grid resize and teardown'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Stopped treating every viewport notification as a full virtual-grid rebuild. Resize now retains the existing `Text` pool while its capacity is unchanged, recycles only the newly exposed window, and reserves a serialized replacement for actual capacity changes. Comparison teardown also stops its animation loop before awaiting outstanding text work, preventing a hidden or replaced workload from continuing background frame submissions.
