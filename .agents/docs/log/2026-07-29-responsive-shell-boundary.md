---
type: Log Entry
title: 'Responsive shell boundary'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Moved the parity-preserved tablet controls sheet, compact workload panel, and mobile bottom navigation out of the benchmark harness so the harness retains state and renderer lifecycle ownership while layout-specific chrome remains independently maintainable.
